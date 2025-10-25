import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  initializeCollection,
  saveTestSession,
  getTestSession,
  getAllTestSessions,
  searchTestSessions,
  filterTestSessions,
  deleteTestSession,
  getTestSessionStats
} from './test-sessions-db.js';

// Load environment variables from .env file
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_FILE = path.join(LOG_DIR, `backend-${new Date().toISOString().split('T')[0]}.log`);

// Clear log file on server start for fresh logs
if (fs.existsSync(LOG_FILE)) {
  fs.unlinkSync(LOG_FILE);
}

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logMessage.trim());
  fs.appendFileSync(LOG_FILE, logMessage);
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

console.log = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [CONSOLE] ${message}\n`;
  originalConsoleLog.apply(console, args);
  fs.appendFileSync(LOG_FILE, logMessage);
};

console.error = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [ERROR] ${message}\n`;
  originalConsoleError.apply(console, args);
  fs.appendFileSync(LOG_FILE, logMessage);
};

console.warn = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [WARN] ${message}\n`;
  originalConsoleWarn.apply(console, args);
  fs.appendFileSync(LOG_FILE, logMessage);
};

console.info = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [INFO] ${message}\n`;
  originalConsoleInfo.apply(console, args);
  fs.appendFileSync(LOG_FILE, logMessage);
};

console.debug = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [DEBUG] ${message}\n`;
  originalConsoleDebug.apply(console, args);
  fs.appendFileSync(LOG_FILE, logMessage);
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE_URL = 'https://api.x.ai/v1';
const MODEL_NAME = 'grok-4-fast-reasoning';

// Grok web search configuration
const GROK_SEARCH_MODEL = 'grok-4-fast-reasoning';
const GROK_SEARCH_PARAMS = {
  mode: 'auto',
  return_citations: true,
  max_search_results: 20
};

const LAWYER_PROMPTS_FILE = path.join(__dirname, 'lawyer_prompts.json');
let LAWYER_PROMPTS = {};

try {
  const promptsData = fs.readFileSync(LAWYER_PROMPTS_FILE, 'utf-8');
  LAWYER_PROMPTS = JSON.parse(promptsData);
  log(`Loaded ${Object.keys(LAWYER_PROMPTS).length} lawyer prompts from ${LAWYER_PROMPTS_FILE}`);
} catch (error) {
  log(`Warning: Could not load lawyer prompts: ${error.message}`, 'WARN');
}

app.use(express.json());

app.use((req, res, next) => {
  log(`[CORS] ${req.method} ${req.url} from ${req.headers.origin || 'unknown'}`);

  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    log(`[CORS] Handling OPTIONS preflight for ${req.url}`);
    return res.status(200).end();
  }

  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeConnections: wss.clients.size,
    timestamp: new Date().toISOString()
  });
});

// Test Sessions API Endpoints

// Get all test sessions
app.get('/api/test-sessions', async (req, res) => {
  try {
    log(`[API] GET /api/test-sessions - limit: ${req.query.limit}, offset: ${req.query.offset}`);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const result = await getAllTestSessions(limit, offset);
    log(`[API] Returning ${result.sessions?.length || 0} sessions`);
    res.json(result);
  } catch (error) {
    log(`Error getting test sessions: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific test session by ID
app.get('/api/test-sessions/:id', async (req, res) => {
  try {
    const result = await getTestSession(req.params.id);
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    log(`Error getting test session: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search test sessions
app.get('/api/test-sessions/search/:query', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await searchTestSessions(req.params.query, limit);
    res.json(result);
  } catch (error) {
    log(`Error searching test sessions: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Filter test sessions
app.post('/api/test-sessions/filter', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await filterTestSessions(req.body, limit);
    res.json(result);
  } catch (error) {
    log(`Error filtering test sessions: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save a test session
app.post('/api/test-sessions', async (req, res) => {
  try {
    const result = await saveTestSession(req.body);
    res.json(result);
  } catch (error) {
    log(`Error saving test session: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a test session
app.delete('/api/test-sessions/:id', async (req, res) => {
  try {
    const result = await deleteTestSession(req.params.id);
    res.json(result);
  } catch (error) {
    log(`Error deleting test session: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get test session statistics
app.get('/api/test-sessions-stats', async (req, res) => {
  try {
    const result = await getTestSessionStats();
    res.json(result);
  } catch (error) {
    log(`Error getting test session stats: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

const FRONTEND_LOG_FILE = path.join(LOG_DIR, `frontend-${new Date().toISOString().split('T')[0]}.log`);

// Clear frontend log file on server start for fresh logs
if (fs.existsSync(FRONTEND_LOG_FILE)) {
  fs.unlinkSync(FRONTEND_LOG_FILE);
}

app.post('/log', (req, res) => {
  try {
    const { timestamp, level, message } = req.body;
    const logMessage = `[${timestamp}] [FRONTEND] [${level}] ${message}\n`;
    fs.appendFileSync(FRONTEND_LOG_FILE, logMessage);
    res.json({ success: true });
  } catch (error) {
    log('Error writing frontend log: ' + error.message, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legislation Engine - Grok Web Search for Legal Research
async function legislationEngine(searchInstructions, country = 'UK') {
  log(`[LEGISLATION_ENGINE] Starting web search for: ${searchInstructions.substring(0, 100)}...`);
  log(`[LEGISLATION_ENGINE] Country: ${country}`);
  log(`[LEGISLATION_ENGINE] Using Grok-4 with web search enabled`);

  try {
    // Create Grok LLM with web search enabled
    const llm = new ChatOpenAI({
      model: GROK_SEARCH_MODEL,
      apiKey: XAI_API_KEY,
      configuration: {
        baseURL: XAI_BASE_URL,
        defaultHeaders: {
          'Content-Type': 'application/json'
        }
      },
      temperature: 0.7,
      maxTokens: 4000,
      modelKwargs: {
        extra_body: {
          search_parameters: GROK_SEARCH_PARAMS
        }
      }
    });

    const systemPrompt = `You are a legal research assistant with access to web search capabilities.

Your task is to search for and provide comprehensive information about:
${searchInstructions}

Focus on ${country} law and legal sources.

Provide:
1. Direct answers to the legal question
2. Relevant legislation, statutes, and regulations
3. Case law and precedents
4. Legal principles and interpretations
5. Citations and sources for all information

Format your response in clear, structured markdown with:
- Headings for different topics
- Bullet points for key points
- Citations in [Source Name](URL) format

All glory goes to God, Amen.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(searchInstructions)
    ];

    log(`[LEGISLATION_ENGINE] Calling Grok with web search...`);

    const response = await llm.invoke(messages);
    const content = response.content;

    log(`[LEGISLATION_ENGINE] Search completed: ${content.length} characters`);

    // Try to extract citations from response metadata
    const citations = [];
    if (response.response_metadata && response.response_metadata.citations) {
      citations.push(...response.response_metadata.citations);
      log(`[LEGISLATION_ENGINE] Found ${citations.length} citations`);
    }

    // Check for web search usage
    if (response.response_metadata && response.response_metadata.usage) {
      const numSources = response.response_metadata.usage.num_sources_used || 0;
      if (numSources > 0) {
        log(`[LEGISLATION_ENGINE] Web search used ${numSources} sources`);
      }
    }

    return {
      success: true,
      content: content,
      sources: citations,
      metadata: {
        country: country,
        query: searchInstructions,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    log(`[LEGISLATION_ENGINE] Error: ${error.message}`, 'ERROR');
    return {
      success: false,
      error: error.message,
      content: `Error searching for legal information: ${error.message}`
    };
  }
}

class TaskCreatorAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      model: MODEL_NAME,
      apiKey: XAI_API_KEY,
      configuration: {
        baseURL: XAI_BASE_URL
      },
      temperature: 0.7,
      verbose: true
    });
    this.conversationHistory = [];
    this.gatheredInfo = {
      agentType: null,
      country: null,
      legalArea: null,
      jurisdiction: null,
      complexity: null
    };
  }

  async conductConversation(userMessage, orchestrator, agentType, country) {
    log(`Task Creator: Conducting conversation with user (Agent: ${agentType}, Country: ${country})`);

    this.conversationHistory.push(new HumanMessage(userMessage));
    this.gatheredInfo.agentType = agentType;
    this.gatheredInfo.country = country;

    const systemPrompt = `You are an intelligent Task Creator Agent that engages in conversation with users to gather sufficient information before creating tasks.

The user has selected to test: ${agentType === 'case_ai' ? 'Case AI' : 'Home Chat AI'} for ${country}

Your role is to:
1. Ask clarifying questions when the user's request is vague or incomplete
2. Autonomously decide when you have enough information to proceed
3. Generate tasks only when you're confident you understand the full scope

Decision-making criteria:
- If the request is clear and specific (e.g., "test the lawyer agent on defamation laws"), you can proceed immediately
- If the request is vague (e.g., "test the lawyer"), ask for: specific legal area, complexity level, number of test cases
- If the request mentions a legal topic but lacks details, ask for: specific aspects to focus on, depth of testing required

When you have sufficient information, respond with a JSON object:
{
  "action": "create_tasks",
  "reasoning": "why you have enough information",
  "ready": true
}

When you need more information, respond with a JSON object:
{
  "action": "ask_question",
  "question": "your clarifying question to the user",
  "reasoning": "what information you still need",
  "ready": false
}

Current conversation context: ${JSON.stringify(this.gatheredInfo)}`;

    const messages = [
      new SystemMessage(systemPrompt),
      ...this.conversationHistory.slice(-10)
    ];

    try {
      let fullContent = '';
      let jsonStarted = false;
      const stream = await this.llm.stream(messages);

      for await (const chunk of stream) {
        const chunkContent = chunk.content || '';
        fullContent += chunkContent;

        // Stop streaming to UI once we detect JSON starting
        if (chunkContent.includes('{')) {
          jsonStarted = true;
        }

        // Only stream non-JSON content to the UI
        if (!jsonStarted) {
          await orchestrator.sendUpdate({
            type: 'agent_stream',
            agent: 'task_creator',
            chunk: chunkContent,
            timestamp: new Date().toISOString()
          });
        }
      }

      const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        log(`Task Creator decision: ${decision.action}`);

        // Clear any streaming message first
        await orchestrator.sendUpdate({
          type: 'clear_stream',
          agent: 'task_creator',
          timestamp: new Date().toISOString()
        });

        if (decision.action === 'ask_question') {
          // Send the question with reasoning (only the question text, not the JSON)
          await orchestrator.sendUpdate({
            type: 'agent_message_with_reasoning',
            agent: 'task_creator',
            message: decision.question,
            reasoning: decision.reasoning,
            messageType: 'question',
            timestamp: new Date().toISOString()
          });

          this.conversationHistory.push(new HumanMessage(fullContent));
          return { needsMoreInfo: true, question: decision.question };
        } else if (decision.action === 'create_tasks') {
          // Send a status message instead of the JSON
          await orchestrator.sendUpdate({
            type: 'agent_message_with_reasoning',
            agent: 'task_creator',
            message: 'I have gathered enough information. Creating test tasks now...',
            reasoning: decision.reasoning,
            messageType: 'status',
            timestamp: new Date().toISOString()
          });

          return { needsMoreInfo: false, ready: true };
        }
      }

      return { needsMoreInfo: false, ready: true };
    } catch (error) {
      log('Task Creator conversation error: ' + error.message, 'ERROR');
      return { needsMoreInfo: false, ready: true };
    }
  }

  async createTasksFromConversation() {
    log('Task Creator: Creating tasks from conversation history');

    const conversationSummary = this.conversationHistory
      .map(msg => msg.content || msg.text || '')
      .join('\n');

    const messages = [
      new SystemMessage(`You are an expert task planner. Based on the conversation history, create a comprehensive list of tasks for testing the lawyer AI agent.

Generate as many tasks as needed - there is NO LIMIT. Create 3, 10, 50, or even 100+ tasks if that's what's required to thoroughly test the lawyer agent.

Each task should be specific and actionable. For example, if testing defamation laws:
- Task 1: Test understanding of actual malice standard for public figures
- Task 2: Test knowledge of statute of limitations for defamation claims
- Task 3: Test ability to distinguish between libel and slander
- Task 4: Test understanding of truth as an absolute defense
- Task 5: Test knowledge of qualified privilege defenses
... and so on

Return a JSON array where each task has:
- id: unique identifier (sequential numbers)
- description: specific test question or scenario
- priority: high/medium/low
- category: the legal area being tested

Return ONLY a valid JSON array, no other text.`),
      new HumanMessage(`Conversation history:\n${conversationSummary}\n\nCreate comprehensive tasks for testing the lawyer agent based on this conversation.`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      const content = response.content;

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tasks = JSON.parse(jsonMatch[0]);
        log(`Task Creator: Created ${tasks.length} tasks`);
        return tasks;
      }

      log('Task Creator: Failed to parse JSON', 'WARN');
      return [{
        id: '1',
        description: 'Test lawyer agent with general legal questions',
        priority: 'high',
        category: 'general'
      }];
    } catch (error) {
      log('Task Creator error: ' + error.message, 'ERROR');
      return [{
        id: '1',
        description: 'Test lawyer agent with general legal questions',
        priority: 'high',
        category: 'general'
      }];
    }
  }
}

class TaskExecutorAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      model: MODEL_NAME,
      apiKey: XAI_API_KEY,
      configuration: {
        baseURL: XAI_BASE_URL
      },
      temperature: 0.7,
      verbose: true
    });
    this.taskHistory = [];
  }

  async executeTask(taskData, orchestrator) {
    log(`Task Executor: Executing task ${taskData.id} - ${taskData.description}`);

    const previousContext = this.taskHistory.length > 0
      ? `Previous task results:\n${this.taskHistory.slice(-3).map(t =>
          `Task: ${t.task}\nLawyer Response: ${t.response.substring(0, 200)}...`
        ).join('\n\n')}`
      : 'This is the first task';

    const messages = [
      new SystemMessage(`You are a Task Executor Agent responsible for testing the JustHemis lawyer AI agent.

Your role is to:
1. Take a specific test task (e.g., "Test understanding of actual malice in defamation law")
2. Formulate a clear, specific question or scenario to send to the lawyer AI
3. The question should thoroughly test the lawyer's knowledge on that specific topic
4. Make questions realistic and challenging, as if a real client is asking

For example:
- Task: "Test knowledge of statute of limitations for defamation"
- Your question: "I was defamed in a newspaper article published 2 years ago in the UK. Is it too late to file a lawsuit? What's the time limit for defamation claims?"

- Task: "Test understanding of qualified privilege defense"
- Your question: "I'm a journalist who published allegations about a politician based on a police report. The politician is suing me for defamation. Can I use qualified privilege as a defense?"

Return a JSON object with:
- question: the specific question to ask the lawyer AI
- reasoning: why this question tests the task objective
- expected_topics: array of legal topics the lawyer should cover in response`),
      new HumanMessage(`Task to execute: ${taskData.description}
Category: ${taskData.category || 'general'}
Priority: ${taskData.priority}

${previousContext}

Formulate a specific, challenging question to test the lawyer AI on this task.
Return ONLY valid JSON, no other text.`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      const content = response.content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const executionPlan = JSON.parse(jsonMatch[0]);
        log(`Task Executor: Generated question for lawyer AI`);

        await orchestrator.sendUpdate({
          type: 'agent_message_with_reasoning',
          agent: 'task_executor',
          message: `Testing: ${taskData.description}\nQuestion: ${executionPlan.question}`,
          reasoning: executionPlan.reasoning,
          messageType: 'task_execution',
          task: taskData,
          timestamp: new Date().toISOString()
        });

        // Start multi-turn conversation with lawyer
        const conversationResult = await this.conductConversationWithLawyer(
          taskData,
          executionPlan,
          orchestrator
        );

        this.taskHistory.push({
          task: taskData.description,
          question: executionPlan.question,
          response: conversationResult.fullConversation
        });

        const evaluation = await this.evaluateResponse(taskData, executionPlan, conversationResult.fullConversation);

        return {
          question: executionPlan.question,
          response: conversationResult.fullConversation,
          evaluation: evaluation,
          status: 'completed',
          turns: conversationResult.turns
        };
      }

      log('Task Executor: Failed to parse JSON', 'WARN');
      return {
        question: taskData.description,
        response: 'Error generating question',
        status: 'error'
      };
    } catch (error) {
      log('Task Executor error: ' + error.message, 'ERROR');
      return {
        question: taskData.description,
        response: `Error: ${error.message}`,
        status: 'error'
      };
    }
  }

  async conductConversationWithLawyer(taskData, executionPlan, orchestrator) {
    log(`Task Executor: Starting multi-turn conversation for task ${taskData.id}`);

    const conversationHistory = [];
    let currentQuestion = executionPlan.question;
    let turns = 0;
    const maxTurns = 10;

    await orchestrator.sendUpdate({
      type: 'task_conversation_start',
      task: taskData,
      timestamp: new Date().toISOString()
    });

    while (turns < maxTurns) {
      turns++;
      log(`Task Executor: Conversation turn ${turns} for task ${taskData.id}`);

      conversationHistory.push({
        role: 'executor',
        message: currentQuestion,
        turn: turns
      });

      // Send the executor's question to the UI (testing panel)
      await orchestrator.sendUpdate({
        type: 'agent_message',
        agent: 'task_executor',
        message: currentQuestion,
        messageType: 'task_execution',
        timestamp: new Date().toISOString()
      });

      // Get lawyer response with streaming
      const lawyerResponse = await orchestrator.homeChatAI.sendMessage(currentQuestion, orchestrator);

      conversationHistory.push({
        role: 'lawyer',
        message: lawyerResponse,
        turn: turns
      });

      // Decide if conversation should continue
      const shouldContinue = await this.shouldContinueConversation(
        taskData,
        executionPlan,
        conversationHistory,
        lawyerResponse
      );

      if (!shouldContinue.continue) {
        log(`Task Executor: Conversation complete after ${turns} turns. Reason: ${shouldContinue.reason}`);
        await orchestrator.sendUpdate({
          type: 'task_conversation_end',
          task: taskData,
          turns: turns,
          reason: shouldContinue.reason,
          timestamp: new Date().toISOString()
        });
        break;
      }

      // Generate follow-up question or answer
      currentQuestion = shouldContinue.followUpQuestion;
      log(`Task Executor: Continuing conversation with: ${currentQuestion.substring(0, 100)}...`);
    }

    if (turns >= maxTurns) {
      log(`Task Executor: Reached maximum turns (${maxTurns}) for task ${taskData.id}`, 'WARN');
    }

    const fullConversation = conversationHistory
      .map(entry => `[${entry.role.toUpperCase()} - Turn ${entry.turn}]: ${entry.message}`)
      .join('\n\n');

    return {
      fullConversation,
      turns,
      conversationHistory
    };
  }

  async shouldContinueConversation(taskData, executionPlan, conversationHistory, lastLawyerResponse) {
    const systemPrompt = `You are analyzing a conversation between a Task Executor and a Lawyer AI to determine if the task has been fully tested.

Task being tested: ${taskData.description}
Expected topics: ${JSON.stringify(executionPlan.expected_topics)}

Conversation so far:
${conversationHistory.slice(-4).map(entry => `${entry.role.toUpperCase()}: ${entry.message}`).join('\n\n')}

Analyze the lawyer's last response and decide:
1. If the lawyer is asking for MORE INFORMATION or CLARIFICATION (e.g., "What jurisdiction?", "When did this happen?", "Can you provide more details?"), you MUST provide a reasonable follow-up answer to continue the conversation
2. If the lawyer has provided a COMPLETE ANSWER covering the expected topics, end the conversation
3. If the lawyer's answer is INCOMPLETE or VAGUE, ask a follow-up question to probe deeper

IMPORTANT: If the lawyer asks a question, you must answer it to continue the conversation naturally.

Return JSON:
{
  "continue": true/false,
  "reason": "explanation of your decision",
  "followUpQuestion": "your follow-up question or answer (only if continue is true)"
}

Return ONLY valid JSON.`;

    try {
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Last lawyer response: ${lastLawyerResponse}`)
      ]);

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        return decision;
      }

      return {
        continue: false,
        reason: 'Failed to parse decision',
        followUpQuestion: null
      };
    } catch (error) {
      log(`Task Executor: Error in shouldContinueConversation: ${error.message}`, 'ERROR');
      return {
        continue: false,
        reason: `Error: ${error.message}`,
        followUpQuestion: null
      };
    }
  }

  async evaluateResponse(taskData, executionPlan, lawyerResponse) {
    log(`Task Executor: Evaluating lawyer response for task ${taskData.id}`);

    const messages = [
      new SystemMessage(`You are an expert legal evaluator. Assess whether the lawyer AI's response adequately addresses the question and covers the expected legal topics.

Provide a brief evaluation with:
- coverage: did it cover the expected topics? (yes/partial/no)
- accuracy: does the response seem legally sound? (good/fair/poor)
- completeness: is the response thorough? (complete/partial/incomplete)
- score: overall score 1-10

Return JSON only.`),
      new HumanMessage(`Task: ${taskData.description}
Question asked: ${executionPlan.question}
Expected topics: ${JSON.stringify(executionPlan.expected_topics || [])}

Lawyer's response:
${lawyerResponse}

Evaluate this response. Return ONLY valid JSON.`)
    ];

    try {
      const response = await this.llm.invoke(messages);
      const content = response.content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { coverage: 'unknown', accuracy: 'unknown', completeness: 'unknown', score: 5 };
    } catch (error) {
      log('Evaluation error: ' + error.message, 'ERROR');
      return { coverage: 'error', accuracy: 'error', completeness: 'error', score: 0 };
    }
  }
}

class HomeChatAIAgent {
  constructor(agentType = 'home_chat', country = 'UK') {
    this.llm = new ChatOpenAI({
      model: MODEL_NAME,
      apiKey: XAI_API_KEY,
      configuration: {
        baseURL: XAI_BASE_URL
      },
      temperature: 0.7,
      verbose: true
    });

    // Define the legislation_engine tool
    this.tools = [
      {
        type: "function",
        function: {
          name: "legislation_engine",
          description: "Search for UK legislation, laws, statutes, regulations, and legal provisions. Use this tool whenever you need to find specific legal information, case law, or statutory provisions.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Detailed search query for the legislation or legal information you need. Be specific and include jurisdiction, topic, and any relevant acts or statutes."
              }
            },
            required: ["query"]
          }
        }
      }
    ];

    this.conversationHistory = [];
    this.agentType = agentType;
    this.country = country;
    this.systemPrompt = this.getSystemPrompt();
  }

  getSystemPrompt() {
    const promptKey = `${this.agentType}_${this.country.toLowerCase()}`;
    log(`Loading system prompt for: ${promptKey}`);

    if (LAWYER_PROMPTS[promptKey]) {
      log(`Using lawyer prompt from file: ${promptKey} (${LAWYER_PROMPTS[promptKey].length} chars)`);
      return LAWYER_PROMPTS[promptKey];
    }

    log(`Warning: No prompt found for ${promptKey}, using fallback`, 'WARN');
    return `You are the JustHemis Lawyer AI - an elite legal AI assistant specializing in ${this.country} law.

Your role is to:
1. Answer legal questions with precision and depth
2. Cite relevant laws, statutes, and legal principles
3. Explain complex legal concepts clearly
4. Provide practical legal guidance
5. Reference case law and precedents when relevant

You have expertise in ${this.country} law including:
- Criminal law, civil law, contract law, tort law
- Defamation, employment law, data protection
- Court procedures and legal strategy

When answering:
- Be thorough and comprehensive
- Cite specific laws and legal principles
- Explain the reasoning behind legal rules
- Provide practical implications
- Use professional legal terminology appropriately
- Structure responses clearly with headings if needed

Remember: You are being tested on your legal knowledge, so demonstrate deep understanding of the law.`;
  }

  async sendMessage(message, orchestrator = null) {
    log(`Lawyer AI (${this.agentType}, ${this.country}): Processing message: ${message.substring(0, 100)}...`);

    const messages = [
      new SystemMessage(this.systemPrompt),
      ...this.conversationHistory.slice(-10),
      new HumanMessage(message)
    ];

    try {
      let fullResponse = '';
      let toolCalls = [];

      // Call LLM with tools
      const stream = await this.llm.stream(messages, {
        tools: this.tools
      });

      for await (const chunk of stream) {
        const chunkContent = chunk.content || '';
        fullResponse += chunkContent;

        // Check if chunk has tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          toolCalls = chunk.tool_calls;
        }

        // Stream content to UI (only if not a tool call)
        if (chunkContent && !chunk.tool_calls && orchestrator) {
          await orchestrator.sendUpdate({
            type: 'lawyer_stream',
            agent: 'home_chat_ai',
            chunk: chunkContent,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Check if response contains a tool call (OpenAI function calling format)
      let toolCallHandled = false;
      let query = null;

      // Check for OpenAI function calling format (proper way)
      if (toolCalls && toolCalls.length > 0) {
        const legislationCall = toolCalls.find(tc => tc.name === 'legislation_engine');

        if (legislationCall) {
          try {
            const args = typeof legislationCall.args === 'string'
              ? JSON.parse(legislationCall.args)
              : legislationCall.args;

            query = args.query;

            if (query) {
              toolCallHandled = true;
              log(`[LAWYER_AI] Detected legislation_engine tool call (OpenAI function calling)`);
              log(`[LAWYER_AI] Query: ${query.substring(0, 100)}...`);
            }
          } catch (parseError) {
            log(`[LAWYER_AI] Failed to parse tool call args: ${parseError.message}`, 'ERROR');
          }
        }
      }

      // Execute the tool call if detected
      if (toolCallHandled && query) {
        // Clear any partial streaming
        if (orchestrator) {
          await orchestrator.sendUpdate({
            type: 'clear_stream',
            agent: 'home_chat_ai',
            timestamp: new Date().toISOString()
          });

          // Show tool usage message
          await orchestrator.sendUpdate({
            type: 'lawyer_tool_call',
            agent: 'home_chat_ai',
            tool: 'legislation_engine',
            query: query,
            timestamp: new Date().toISOString()
          });
        }

        // Execute the legislation engine
        const searchResult = await legislationEngine(query, this.country);

        if (searchResult.success) {
          log(`[LAWYER_AI] Legislation engine returned ${searchResult.content.length} characters`);

          // Return the search result as the lawyer's response
          fullResponse = searchResult.content;

          // Stream the result to UI
          if (orchestrator) {
            await orchestrator.sendUpdate({
              type: 'lawyer_message',
              agent: 'home_chat_ai',
              message: fullResponse,
              sources: searchResult.sources,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          log(`[LAWYER_AI] Legislation engine failed: ${searchResult.error}`, 'ERROR');
          fullResponse = `I attempted to search for legal information but encountered an error: ${searchResult.error}`;

          if (orchestrator) {
            await orchestrator.sendUpdate({
              type: 'lawyer_message',
              agent: 'home_chat_ai',
              message: fullResponse,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // If no tool call was handled, send the final message
      if (!toolCallHandled && orchestrator) {
        await orchestrator.sendUpdate({
          type: 'lawyer_message',
          agent: 'home_chat_ai',
          message: fullResponse,
          timestamp: new Date().toISOString()
        });
      }

      this.conversationHistory.push(new HumanMessage(message));
      this.conversationHistory.push(new AIMessage(fullResponse));

      log(`Lawyer AI: Generated response (${fullResponse.length} chars)`);
      return fullResponse;
    } catch (error) {
      log('Lawyer AI error: ' + error.message, 'ERROR');
      return `Error communicating with Lawyer AI: ${error.message}`;
    }
  }

  resetConversation() {
    this.conversationHistory = [];
    log('Lawyer AI: Conversation history reset');
  }
}

class MultiAgentOrchestrator {
  constructor(websocket) {
    this.ws = websocket;
    this.taskCreator = new TaskCreatorAgent();
    this.taskExecutor = new TaskExecutorAgent();
    this.homeChatAI = null;
    this.conversationMode = true;
    this.tasks = [];
    this.agentType = 'home_chat';
    this.country = 'UK';
  }

  async processUserInput(userInput, agentType = 'home_chat', country = 'UK') {
    log(`Orchestrator: Processing user input in conversation mode (Agent: ${agentType}, Country: ${country})`);

    if (!this.homeChatAI || this.agentType !== agentType || this.country !== country) {
      this.agentType = agentType;
      this.country = country;
      this.homeChatAI = new HomeChatAIAgent(agentType, country);
      log(`Orchestrator: Created new Lawyer AI agent (${agentType}, ${country})`);
    }

    if (this.conversationMode) {
      await this.sendUpdate({
        type: 'status',
        message: 'Task Creator is analyzing your request...',
        agent: 'task_creator',
        status: 'working'
      });

      const conversationResult = await this.taskCreator.conductConversation(userInput, this, agentType, country);

      if (conversationResult.needsMoreInfo) {
        log('Orchestrator: Task Creator needs more information');
        return { status: 'awaiting_user_response', question: conversationResult.question };
      }

      log('Orchestrator: Task Creator has sufficient information, creating tasks');
      this.conversationMode = false;

      await this.sendUpdate({
        type: 'status',
        message: 'Task Creator is generating tasks...',
        agent: 'task_creator',
        status: 'working'
      });

      this.tasks = await this.taskCreator.createTasksFromConversation();

      await this.sendUpdate({
        type: 'tasks_created',
        tasks: this.tasks,
        agent: 'task_creator',
        status: 'completed',
        timestamp: new Date().toISOString()
      });

      await this.executeAllTasks();

      return { status: 'tasks_created_and_executing', taskCount: this.tasks.length };
    }

    return { status: 'error', message: 'Invalid state' };
  }

  async executeAllTasks() {
    log(`Orchestrator: Executing ${this.tasks.length} tasks`);

    const results = [];

    for (let idx = 0; idx < this.tasks.length; idx++) {
      const taskData = this.tasks[idx];

      await this.sendUpdate({
        type: 'status',
        message: `Task Executor is working on task ${idx + 1}/${this.tasks.length}: ${taskData.description}`,
        agent: 'task_executor',
        status: 'working',
        task: taskData,
        progress: {
          current: idx + 1,
          total: this.tasks.length,
          percentage: Math.round(((idx + 1) / this.tasks.length) * 100)
        }
      });

      const executionResult = await this.taskExecutor.executeTask(taskData, this);

      results.push({
        task: taskData,
        result: executionResult
      });

      await this.sendUpdate({
        type: 'task_completed',
        task: taskData,
        result: executionResult,
        progress: {
          current: idx + 1,
          total: this.tasks.length,
          percentage: Math.round(((idx + 1) / this.tasks.length) * 100)
        },
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await this.sendUpdate({
      type: 'all_tasks_completed',
      results: results,
      status: 'completed',
      summary: {
        totalTasks: this.tasks.length,
        completedTasks: results.filter(r => r.result.status === 'completed').length,
        averageScore: results.reduce((sum, r) => sum + (r.result.evaluation?.score || 0), 0) / results.length
      },
      timestamp: new Date().toISOString()
    });

    log('Orchestrator: All tasks completed');
    return results;
  }

  async sendUpdate(data) {
    try {
      this.ws.send(JSON.stringify(data));
    } catch (error) {
      log('Error sending update: ' + error.message, 'ERROR');
    }
  }

  reset() {
    this.conversationMode = true;
    this.tasks = [];
    this.taskCreator = new TaskCreatorAgent();
    this.taskExecutor = new TaskExecutorAgent();
    this.homeChatAI.resetConversation();
    log('Orchestrator: Reset to initial state');
  }
}

wss.on('connection', async (ws) => {
  log('WebSocket client connected. Total connections: ' + wss.clients.size);

  const orchestrator = new MultiAgentOrchestrator(ws);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      log('Received message: ' + data.type);

      if (data.type === 'user_input') {
        const userInput = data.message;
        const agentType = data.agentType || 'home_chat';
        const country = data.country || 'UK';
        log(`Processing user input: ${userInput} (Agent: ${agentType}, Country: ${country})`);

        await orchestrator.processUserInput(userInput, agentType, country);
      } else if (data.type === 'reset') {
        log('Resetting orchestrator');
        orchestrator.reset();
        ws.send(JSON.stringify({
          type: 'reset_complete',
          message: 'System reset. Ready for new conversation.'
        }));
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      log('Error processing message: ' + error.message, 'ERROR');
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message,
        stack: error.stack
      }));
    }
  });

  ws.on('close', () => {
    log('WebSocket client disconnected. Total connections: ' + wss.clients.size);
  });

  ws.on('error', (error) => {
    log('WebSocket error: ' + error.message, 'ERROR');
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to Multi-Agent System - Conversational Task Creator Ready',
    timestamp: new Date().toISOString()
  }));
});

const PORT = process.env.PORT || 17000;
server.listen(PORT, '0.0.0.0', async () => {
  log('========================================');
  log('SERVER STARTED - FRESH LOGS');
  log('========================================');
  log(`Multi-Agent System server running on port ${PORT}`);
  log(`WebSocket endpoint: ws://localhost:${PORT}`);
  log(`Backend logs: ${LOG_FILE}`);
  log(`Frontend logs: ${FRONTEND_LOG_FILE}`);
  log(`Using XAI API key: ${XAI_API_KEY.substring(0, 10)}...${XAI_API_KEY.substring(XAI_API_KEY.length - 4)}`);
  log(`API Base URL: ${XAI_BASE_URL}`);
  log(`Model: ${MODEL_NAME}`);
  log('========================================');

  // Initialize Qdrant database
  log('Initializing Qdrant vector database...');
  const dbInit = await initializeCollection();
  if (dbInit.success) {
    log('Qdrant database initialized successfully');
  } else {
    log(`Qdrant database initialization failed: ${dbInit.error}`, 'ERROR');
  }
});