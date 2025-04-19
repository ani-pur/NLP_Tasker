#hasher for managing passwords in users.json
import string
import werkzeug.security
import json

def hasher(name, password):     # runs user password through hasher (no salting and all that yet) and saves name:hash pair in users.json for authentication

    hashed_pw = werkzeug.security.generate_password_hash(password)  
    with open('users.json', 'r') as file:
        users=json.load(file)
    users[name]=hashed_pw       
    with open('users.json','w') as file:
        json.dump(users,file,indent=4)
        print("user added")
    
    
while True:
    print('1. add user')
    print('2. delete user')
    print('3. list users')
    print('4. exit')
    
    try:
        option = int(input("enter option: "))
        
        if option == 1:    
            name = input("Enter name: ")  # Changed string() to input()
            password = input("enter user password: ")  # Changed string() to input()
            hasher(name, password)
            # No break here to return to menu
            
        elif option == 2:
            #IMPLEMENTED
            
            # list saved profiles, take admin input and parse users.json until {input}:hash match is found and delete, save updates
            
            with open('users.json','r') as file:
                userData=json.load(file)
                for i in userData.keys():
                    print(i,'\n')
                parseName=input("Enter profile to be deleted: ")
                if parseName in userData.keys():
                    with open('users.json','w') as file:
                        print('found, deleting...')  
                        del userData[parseName]
                        print(userData.keys())
                        json.dump(userData,file,indent=4)
                        break  
                else:
                    print('error: profile does not exist')  
                    break
                      
                    
        elif option == 3:           #IMPLEMENTED
            with open('users.json','r') as file:
                userData=json.load(file)
                for i in userData.keys():
                    print(i,'\n')
            
        elif option == 4:
            print("Exiting program...")
            break  # This will exit the while loop
            
        else:
            print("Invalid option, please try again.")
            
    except ValueError:
        print("Please enter a valid number. [OR EMPTY LIST]")