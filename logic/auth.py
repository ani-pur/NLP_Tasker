import json
import werkzeug.security

def load_users():
    with open('users.json','r') as file:
        return json.load(file) #loads file contents into cache i think

def verify_login(input_pass):
    users=load_users() #contents in cash assigned to variable 
    for username, stored_hash in users.items(): 
        if werkzeug.security.check_password_hash(stored_hash,input_pass):
            return username #found matching user
    return None

if __name__=="__main__":
    # prompt user to input password
    input_pass=input("enter password: ").strip()
    user=verify_login(input_pass) #user variable is assigned the value that is returned by verify_login, there's no error handling gg

    if user:
        print(f"bismillah found a match \n welcome, {user}")
    else:
        print("404: no match found or something broke")
