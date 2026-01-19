Author: Anirudh Purohit

## What is Tasker?

Tasker is built for people who want to write tasks normally. No forms, no strict formatting. Just type what you need to do and Tasker will figure out the rest.

Tasks are automatically sorted, support colors, and stay in sync across devices. Tasker offers multiple desktop UI's and a mobile webapp.

Signup is simple, usage is streamlined, data is safe, privacy is upheld. 

### Coming soon:  
- **Google calendar sync and notifications**

### Known bugs:
- ~~Tasks on the same day may be sorted wrong on the dashboard~~ fixed january 17th
 
## Deployment and Architecture:

- Reverse proxied through Cloudflare using [Cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

Tasker is deployed as a stateless, containerized application with a separate PostgreSQL container for persistent storage.

Production traffic is routed through a Cloudflare reverse proxy using Cloudflared, allowing global access without directly exposing the host server.

The application runs on personal infrastructure hosted on a repurposed machine and includes isolated testing environments with restricted access. Deployment and management are handled through custom scripts and a lightweight CI/CD pipeline, with further automation planned using GitHub Actions.

## Screenshots

### v2.5: 

<img width="1201" height="641" alt="image" src="https://github.com/user-attachments/assets/e2404639-82d1-474b-9dec-298cf2283c07" />

![image](https://github.com/user-attachments/assets/b00314c3-bf7d-4219-b73b-92e99021844c)



### v2:
![image](https://github.com/user-attachments/assets/5c4302be-927e-46ac-89e5-09f6022c153f)
![image](https://github.com/user-attachments/assets/fd7f6fba-d2ff-4913-ba9e-83ac3624ab72)
![image](https://github.com/user-attachments/assets/f40bc4ea-1a7f-4ae4-8b64-8a0797b81df4)

### v1:
![image](https://github.com/user-attachments/assets/2e90706c-0b1d-4adc-93f3-25b578a86598)
![image](https://github.com/user-attachments/assets/4fb92ee7-39b6-47af-83cd-d63723697f12)
![image](https://github.com/user-attachments/assets/7e854af8-19e0-4eac-9da6-5c2b17352d7f)





