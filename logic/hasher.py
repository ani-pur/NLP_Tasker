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



# run user password through hasher and save name:hash pair in db
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

            except psycopg2.Error as e:
                print("DB error: ",e)

    return hashedPass


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
def verify_login(input_pass):
        with dbConnect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("SELECT * FROM users;")
                    dbResponse = cur.fetchall()
                    #print(dbResponse)
                    for i in dbResponse:
                        if wz.check_password_hash(i[1],input_pass):
                            print("MATCH FOUND: ",i[0])
                            return str(i[0])
                        

                except psycopg2.Error as e:
                    print("DB error: ",e)
                
    
# menu for CRUD operations
def crudOps():
    while True:
        menuInp = int(input(" 1. create profile \n 2. delete profile \n 3. display profiles \n 4. exit \n"))
        if menuInp==1:
            hasher()

        elif menuInp==2:
            delProfile()
        
        elif menuInp==3:
            displayProfiles()
        
        elif menuInp==5:
            input_pass=str(input("enter password to crosscheck: "))
            verify_login(input_pass)
        elif menuInp==4:
            break



# if program is run from CLI
if __name__=="__main__":
    crudOps()


