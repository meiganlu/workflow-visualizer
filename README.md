# GitHub Workflow Visualizer

GitHub Workflow Visualizer is a tool that transforms public repository commit history into an interactive graph, making it easier to understand development workflows, branch structures, pull request activity, and contributor behavior. Users are able to visualize relationships between commits, identify merge points, and analyze repository evolution.

> [!IMPORTANT]
> To maintain responsiveness and prevent excessive API requests, visualizations are generated using the most recent 1,500 commits. For larger repos, the graph only represents recent development activity.


## Core Features

* **Interactive Graph Visualization**:
    * Zoom and pan through repository history
    * Drag nodes to explore commit structures
    * View parent-child commit relationships
* **Branch Analysis**: Filter commits by branch, toggle branch visibility, and compare development activity across branches
* **Repository Insights**: Look at repository statistics and branch activity metrics
* **Commit Exploration**: Hover over commits to view commit SHA, author, commit message, associated branches, and more


## Tech Stack

### Frontend
* React
* Typescript
* D3.js

### Backend
* Node.js
* Express


## Getting Started Locally

### Prerequisites
- Make sure to have a GitHub PAT generated

> [!NOTE]
> If you want to access your private repositories, ensure your PAT has the right repo permissions.


### Setup
1. Clone the repository

2. Install frontend dependencies:

```
npm install
```

3. Install backend dependencies:

```
cd backend
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


## Visual Overview
![](/images/workflow-visualizer.png)