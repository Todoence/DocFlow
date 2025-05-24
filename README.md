## DocFlow: An automated document processing system for manufacturing trade operations.

### Demo video
[https://drive.google.com/file/d/1XWPkX6FN6Vrhc4KCLNVEcIHkLcauoPO1/view?usp=sharing)
### Tech Stack
- **Frontend**: React + TypeScript + Ant Design  
- **Backend**: FastAPI + Uvicorn + asyncpg + httpx  
- **DB**: PostgreSQL (Neon)  
- **Containerization**: Docker & Docker Compose  

### Quick Start with Docker (Highly recommend)

 1. Clone the repo
 2. Run `docker-compose up --build`
 3. Open bower to Frontend: [http://localhost:3000](http://localhost:3000)
 4. API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Start without Docker

 1. Clone the repo
 2. Run `pip install -r requirements.txt`
 3. Run `uvicorn app:app --reload --port 8000`to start backend
 4. Open different terminal and run `cd frontend` move to frontend directory
 5. Run `npm install`
 6. Run `set PORT=3000&&npm start`
 7. Open bower to Frontend: [http://localhost:3000](http://localhost:3000)
 8. API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
