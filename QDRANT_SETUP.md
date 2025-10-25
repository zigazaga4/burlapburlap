# Qdrant Vector Database Setup

This project uses Qdrant to store complete test session data for the multi-agent testing system.

## What is Stored

Each test session stores everything needed to reconstruct the 3-panel view:

### Panel 1 (Left): Task Creator Conversation
- Complete conversation history between user and Task Creator agent
- All messages with timestamps and roles

### Panel 2 (Middle): Generated Tasks
- List of all generated tasks
- Task descriptions, IDs, timestamps
- Scores and reasoning for each task

### Panel 3 (Right): Task Executions
- Complete conversations between Task Executor and Lawyer AI for each task
- All messages with timestamps and roles
- Scores and reasoning for each execution

### Overall Metrics
- Overall session score
- Total tasks, completed tasks
- Average scores

## Quick Start with Docker

1. **Start Qdrant**:
   ```bash
   cd testing-agents
   docker-compose up -d
   ```

2. **Verify Qdrant is running**:
   ```bash
   curl http://localhost:6333/collections
   ```

3. **Start the backend server** (it will auto-initialize the collection):
   ```bash
   npm run dev
   ```

## Docker Compose Configuration

The `docker-compose.yml` file includes:
- Qdrant service on ports 6333 (REST) and 6334 (gRPC)
- Persistent storage in `./qdrant_storage`
- Auto-restart policy

## API Endpoints

### Get All Test Sessions
```bash
GET /api/test-sessions?limit=50&offset=0
```

### Get Specific Test Session
```bash
GET /api/test-sessions/:sessionId
```

### Search Test Sessions
```bash
GET /api/test-sessions/search/:query?limit=10
```

### Filter Test Sessions
```bash
POST /api/test-sessions/filter
Body: {
  "agentType": "home_chat",
  "country": "UK",
  "minScore": 7,
  "maxScore": 10,
  "startDate": "2025-01-01",
  "endDate": "2025-12-31"
}
```

### Save Test Session
```bash
POST /api/test-sessions
Body: {
  "sessionId": "unique-session-id",
  "agentType": "home_chat",
  "country": "UK",
  "timestamp": "2025-10-25T16:00:00.000Z",
  "taskCreatorConversation": [...],
  "generatedTasks": [...],
  "taskExecutions": [...],
  "overallScore": 8.5,
  "totalTasks": 10,
  "completedTasks": 10,
  "averageScore": 8.5
}
```

### Delete Test Session
```bash
DELETE /api/test-sessions/:sessionId
```

### Get Statistics
```bash
GET /api/test-sessions-stats
```

## Data Structure

### Test Session Object
```javascript
{
  sessionId: "uuid",
  agentType: "home_chat" | "case_ai",
  country: "UK" | "USA" | "Canada",
  timestamp: "ISO 8601 timestamp",
  
  // Panel 1: Task Creator conversation
  taskCreatorConversation: [
    {
      role: "user" | "assistant",
      content: "message content",
      timestamp: "ISO 8601 timestamp"
    }
  ],
  
  // Panel 2: Generated tasks
  generatedTasks: [
    {
      id: "task-id",
      description: "task description",
      timestamp: "ISO 8601 timestamp",
      score: 8.5,
      reasoning: "evaluation reasoning"
    }
  ],
  
  // Panel 3: Task executions
  taskExecutions: [
    {
      taskId: "task-id",
      conversation: [
        {
          role: "tester" | "lawyer",
          content: "message content",
          timestamp: "ISO 8601 timestamp"
        }
      ],
      score: 8.5,
      reasoning: "evaluation reasoning"
    }
  ],
  
  // Overall metrics
  overallScore: 8.5,
  totalTasks: 10,
  completedTasks: 10,
  averageScore: 8.5
}
```

## Stopping Qdrant

```bash
docker-compose down
```

To also remove the data:
```bash
docker-compose down -v
rm -rf qdrant_storage
```

## Accessing Qdrant Dashboard

Qdrant provides a web UI at:
```
http://localhost:6333/dashboard
```

All glory goes to God, Amen!

