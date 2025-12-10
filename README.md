# GitHub Workflow Visualizer

This is a tool that visualizes a Git repository history, including branches, PRs, and commit patterns.


## Getting Started

### Prerequisites
- Make sure to have a GitHub PAT generated

> [!NOTE]
> If you want to access your private repositories, ensure your PAT has the right repo permissions.


### Setup
1. Clone the repository

2. Install dependencies:

```
npm install
```

3. Create `.env` in `/backend` and add your GitHub PAT

```
GITHUB_TOKEN=<your_personal_access_token>
```

4. In one terminal, run the backend server

```
cd backend
npm run dev
```

5. In a second terminal, run the frontend server from `/workflow-visualizer`

```
npm start
```