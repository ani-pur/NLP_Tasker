Author: Anirudh Purohit

## What is Tasker?

Tasker is a self-hosted, AI powered task manager built with Flask and PostgreSQL.
It takes freeform, natural language input (like “finish physics lab tomorrow at 5”) and uses an LLM to convert it into structured, categorized task objects. The app runs inside a fully containerized environment with separate production and testing environments, and is deployed through a Cloudflare Tunnel so the origin server remains private. Tasker includes automatic mobile/desktop UI switching, persistent Postgres storage, and a lightweight CI/CD pipeline for shipping updates quickly.

### Coming soon:  
- **Google calendar sync and notifications** (~late december)



 
## Deployment and Architecture:

- Containerized with Docker
- Reverse proxied through Cloudflare using [Cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- UI auto-switches between mobile and desktop based on User-Agent headers


## Screenshots (v1, old):
![image](https://github.com/user-attachments/assets/2e90706c-0b1d-4adc-93f3-25b578a86598)

![image](https://github.com/user-attachments/assets/4fb92ee7-39b6-47af-83cd-d63723697f12)

![image](https://github.com/user-attachments/assets/7e854af8-19e0-4eac-9da6-5c2b17352d7f)

## UPDATED Screenshots (v2):
![image](https://github.com/user-attachments/assets/5c4302be-927e-46ac-89e5-09f6022c153f)
![image](https://github.com/user-attachments/assets/fd7f6fba-d2ff-4913-ba9e-83ac3624ab72)
![image](https://github.com/user-attachments/assets/f40bc4ea-1a7f-4ae4-8b64-8a0797b81df4)



