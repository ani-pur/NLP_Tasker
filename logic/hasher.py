#hasher for managing passwords in users.json
import string
import werkzeug.security
import json

def hasher(name, password):

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
            print('Not implemented yet')
            # No break here to return to menu
            
        elif option == 3:
            print('Not implemented yet')
            # No break here to return to menu
            
        elif option == 4:
            print("Exiting program...")
            break  # This will exit the while loop
            
        else:
            print("Invalid option, please try again.")
            
    except ValueError:
        print("Please enter a valid number.")