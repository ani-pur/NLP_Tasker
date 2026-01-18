# THIS MODULE HANDLES CREDENTIALS AND AUTHENTICATION


import werkzeug.security as wz
import os
#import json
import psycopg2

# connect to db
def dbConnect():
    return psycopg2.connect(
        dbname = os.environ.get('POSTGRES_DB'),
        user = os.environ.get('POSTGRES_USER'),
        password = os.environ.get('POSTGRES_PASSWORD'),
        host = os.environ.get('POSTGRES_HOST'),
        port = os.environ.get('POSTGRES_PORT')
    )



# create profile
def hasher():     
    
    name = str(input("enter name: "))
    password = str(input("enter password: "))
    hashedPass = wz.generate_password_hash(password)
    
    with dbConnect() as conn:
        with conn.cursor() as cur:
            try: 
                cur.execute(
                    "INSERT INTO users VALUES (%s, %s)",(name,hashedPass)
                )
                conn.commit()

            except psycopg2.Error as e:
                print("DB error: ",e)

    return hashedPass

def hash_password(password: str):
    return wz.generate_password_hash(password)

def delProfile():

    with dbConnect() as conn:
        with conn.cursor() as cur:
            try:
                
                cur.execute("SELECT * FROM users;")
                rows = cur.fetchall()
                for i in rows: 
                    print('\n',i,'\n')
                
                name = str(input("enter name of profile to delete: "))

                cur.execute(
                    "DELETE FROM users WHERE USERNAME = %s ;"
                ,(name,))

                conn.commit()

                cur.execute("SELECT * FROM users;")
                rows = cur.fetchall()
                for i in rows: 
                    print('\n',i,'\n')

            except psycopg2.Error as e:
                print("DB error: ",e)

# approve pending profiles
def merge_approve():
    print("\n Options: \n \t 1: List pending profiles \n \t 2: Approve and merge manually \n \t 3: Approve and merge all \n \t 4. Exit \n")
    choice = int(input('1/2/3: '))

    # List pending profiles
    if choice == 1:
        with dbConnect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("SELECT * FROM PendingApprovals;")
                    dbResponse = cur.fetchall()
                    for i in dbResponse:
                        print('\n',i,'\n')
                except psycopg2.Error as e:
                    print("DB error: ",e)
        merge_approve()
    
    # Approve and merge manually, iterate through rows
    elif choice == 2:
        with dbConnect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("SELECT * FROM PendingApprovals;")
                    dbResponse = cur.fetchall()
                    for i in dbResponse:
                        print('\n',i,'\n')
                        choice_2 = str(input('Approve? y/n: '))
                        if choice_2 == 'y':
                            index=i[0]  # index of row
                            cur.execute(f"INSERT INTO users (username, pwhash) SELECT username, password_hash FROM PendingApprovals WHERE id = {index}")
                            print(f'Merged {index}')
                            conn.commit()
                            cur.execute(f"DELETE FROM pendingapprovals WHERE id = {index};")
                            conn.commit()
                        elif choice_2 == 'n':
                            index=i[0]
                            cur.execute(f"DELETE FROM pendingapprovals WHERE id = {index};")
                            print(f"Deleted {index}")
                            conn.commit()
                        else:
                            print("[!] y: yes \t n: no")
                except psycopg2.Error as e:
                    print("DB error: ",e)

    # Approve and merge all
    elif choice == 3:
        print("[!] MERGE ALL [!] \n Are you sure? \n y/n: ")
        confirmation = str(input())
        if confirmation == 'y':
            with dbConnect() as conn:
                with conn.cursor() as cur:
                    try:
                        cur.execute("SELECT * FROM PendingApprovals;")
                        print('\n MERGING INTO TABLE [USERS] \n')
                        cur.execute(" INSERT INTO users (username, pwhash) SELECT username, password_hash FROM PendingApprovals ON CONFLICT (username) DO NOTHING;")
                        print('\n Merged. \n')
                        conn.commit()

                    except psycopg2.Error as e:
                        print("DB error: ", e)
        elif confirmation == 'n':
            merge_approve()

    # Exit to previous menu        
    elif choice == 4: 
        return None
    
    # Trash input default case
    else: 
        merge_approve()



def displayProfiles():
    with dbConnect() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT * FROM users;")
                dbResponse = cur.fetchall()
                for i in dbResponse:
                    print('\n',i, '\n')
            except psycopg2.Error as e:
                print("DB error: ",e)


# AUTHENTICATE LOGIN
def verify_login(username, input_pass):
    with dbConnect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, pwhash FROM users WHERE username = %s;",
                (username,)
            )
            row = cur.fetchone()

            if row is None:
                return None  # user doesn't exist

            if wz.check_password_hash(row[1], input_pass):
                return row[0]  # username

            return None

                
    
# menu for CRUD operations
def crudOps():
    while True:
        menuInp = int(input(" 1. create profile \n 2. delete profile \n 3. display profiles \n 4. Approve accounts \n 5. exit \n"))
        if menuInp==1:
            hasher()

        elif menuInp==2:
            delProfile()
        
        elif menuInp==3:
            displayProfiles()
        
        elif menuInp==4:
            merge_approve()
        
        elif menuInp==5:
            break
        



# if program is run from CLI
if __name__=="__main__":
    crudOps()


