<script>
  import { onMount, onDestroy } from 'svelte';
  import { logger } from './lib/logger.js';
  import { marked } from 'marked';

  let ws = null;
  let connected = $state(false);
  let userInput = $state('');
  let messages = $state([]);
  let tasks = $state([]);
  let currentAgent = $state(null);
  let isProcessing = $state(false);
  let testingMessages = $state([]);
  let showTestingPanel = $state(false);
  let selectedAgentType = $state('home_chat');
  let selectedCountry = $state('UK');
  let streamingMessages = $state(new Map());
  let expandedReasonings = $state(new Set());
  let expandedTasks = $state(new Set());

  const WS_URL = 'ws://localhost:17000';

  marked.setOptions({
    breaks: true,
    gfm: true
  });

  function connectWebSocket() {
    try {
      logger.info('Attempting to connect to WebSocket: ' + WS_URL);
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        connected = true;
        addSystemMessage('Connected to Multi-Agent System');
        logger.info('WebSocket connected successfully');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        logger.debug('Received WebSocket message: ' + data.type);
        handleMessage(data);
      };

      ws.onerror = (error) => {
        logger.error('WebSocket error: ' + JSON.stringify(error));
        addSystemMessage('WebSocket error occurred', 'error');
      };

      ws.onclose = () => {
        connected = false;
        addSystemMessage('Disconnected from server', 'warning');
        logger.warn('WebSocket disconnected');

        setTimeout(() => {
          if (!connected) {
            addSystemMessage('Attempting to reconnect...', 'info');
            logger.info('Attempting to reconnect to WebSocket');
            connectWebSocket();
          }
        }, 3000);
      };
    } catch (error) {
      logger.error('Failed to connect to WebSocket: ' + error.message);
      addSystemMessage('Failed to connect to server', 'error');
    }
  }

  function handleMessage(data) {
    logger.debug('Handling message type: ' + data.type);

    switch (data.type) {
      case 'connected':
        addSystemMessage(data.message, 'success');
        logger.info('Connection confirmed by server');
        break;

      case 'status':
        currentAgent = data.agent;
        isProcessing = data.status === 'working';
        if (data.progress) {
          addAgentMessage(data.agent, `${data.message} (${data.progress.percentage}%)`, 'status');
        } else {
          addAgentMessage(data.agent, data.message, 'status');
        }
        break;

      case 'task_conversation_start':
        addTaskSeparator(data.task);
        // Auto-expand the new task
        expandedTasks.add(data.task.id);
        expandedTasks = new Set(expandedTasks);
        break;

      case 'task_conversation_end':
        addConversationEndMarker(data.task, data.turns, data.reason);
        break;

      case 'agent_stream':
        handleAgentStream(data.agent, data.chunk);
        break;

      case 'clear_stream':
        clearAgentStream(data.agent);
        break;

      case 'lawyer_stream':
        handleLawyerStream(data.agent, data.chunk);
        break;

      case 'lawyer_tool_call':
        addLawyerToolCall(data.tool, data.query);
        break;

      case 'lawyer_message':
        clearLawyerStream(data.agent);
        addLawyerMessage(data.message, data.sources);
        break;

      case 'agent_message_with_reasoning':
        if (data.messageType === 'question') {
          addAgentMessageWithReasoning(data.agent, data.message, 'question', data.reasoning);
          isProcessing = false;
        } else if (data.messageType === 'task_execution') {
          addTestingMessageWithReasoning('task_executor', data.message, 'question', data.reasoning);
        } else if (data.messageType === 'response') {
          addTestingMessageWithReasoning('home_chat_ai', data.message, 'response', data.reasoning);
        }
        break;

      case 'agent_message':
        if (data.messageType === 'question') {
          addAgentMessage(data.agent, data.message, 'question');
          isProcessing = false;
        } else if (data.messageType === 'task_execution') {
          console.log('[FRONTEND] Task Executor message received:', data.message.substring(0, 100));
          addTestingMessage('task_executor', data.message, 'question');
        } else if (data.messageType === 'response') {
          addTestingMessage('home_chat_ai', data.message, 'response');
        }
        break;

      case 'tasks_created':
        tasks = data.tasks;
        showTestingPanel = true;
        addSystemMessage(`Task Creator generated ${data.tasks.length} tasks`, 'success');
        logger.info(`Tasks created: ${data.tasks.length}`);
        break;

      case 'task_completed':
        if (data.result && data.result.evaluation) {
          const evaluation = data.result.evaluation;
          addSystemMessage(
            `Task ${data.progress.current}/${data.progress.total} completed - Score: ${evaluation.score}/10 (Coverage: ${evaluation.coverage}, Accuracy: ${evaluation.accuracy})`,
            'info'
          );
        }
        break;

      case 'all_tasks_completed':
        isProcessing = false;
        currentAgent = null;
        if (data.summary) {
          addSystemMessage(
            `All ${data.summary.totalTasks} tasks completed! Average score: ${data.summary.averageScore.toFixed(1)}/10`,
            'success'
          );
        } else {
          addSystemMessage('All tasks completed successfully', 'success');
        }
        break;

      case 'reset_complete':
        addSystemMessage(data.message, 'success');
        messages = [];
        tasks = [];
        isProcessing = false;
        currentAgent = null;
        break;

      case 'error':
        addSystemMessage(`Error: ${data.message}`, 'error');
        logger.error('Server error: ' + data.message);
        isProcessing = false;
        break;

      case 'pong':
        break;

      default:
        console.log('Unknown message type:', data.type);
        logger.warn('Unknown message type: ' + data.type);
    }
  }

  function handleAgentStream(agent, chunk) {
    const key = `${agent}_stream`;
    const currentContent = streamingMessages.get(key) || '';
    const newContent = currentContent + chunk;
    streamingMessages.set(key, newContent);

    const existingMessage = messages.find(m => m.id === key);
    if (existingMessage) {
      existingMessage.text = newContent;
      existingMessage.html = marked.parse(newContent);
      messages = [...messages];
    } else {
      messages = [...messages, {
        id: key,
        type: 'agent',
        agent: agent,
        text: newContent,
        html: marked.parse(newContent),
        messageType: 'streaming',
        timestamp: new Date().toISOString()
      }];
    }
    scrollToBottom();
  }

  function clearAgentStream(agent) {
    const key = `${agent}_stream`;
    streamingMessages.delete(key);

    // Remove the streaming message from the messages array
    messages = messages.filter(m => m.id !== key);
  }

  function handleLawyerStream(agent, chunk) {
    const key = `${agent}_lawyer_stream`;
    const currentContent = streamingMessages.get(key) || '';
    const newContent = currentContent + chunk;
    streamingMessages.set(key, newContent);

    const existingMessage = testingMessages.find(m => m.id === key);
    if (existingMessage) {
      existingMessage.text = newContent;
      existingMessage.html = marked.parse(newContent);
      testingMessages = [...testingMessages];
    } else {
      testingMessages = [...testingMessages, {
        id: key,
        type: 'agent',
        agent: agent,
        text: newContent,
        html: marked.parse(newContent),
        messageType: 'streaming',
        timestamp: new Date().toISOString()
      }];
    }
    scrollToBottom();
  }

  function clearLawyerStream(agent) {
    const key = `${agent}_lawyer_stream`;
    streamingMessages.delete(key);
    testingMessages = testingMessages.filter(m => m.id !== key);
  }

  function addLawyerToolCall(tool, query) {
    testingMessages = [...testingMessages, {
      id: `tool_call_${Date.now()}`,
      type: 'tool_call',
      agent: 'home_chat_ai',
      tool: tool,
      query: query,
      timestamp: new Date().toISOString()
    }];
    scrollToBottom();
  }

  function addLawyerMessage(message, sources = []) {
    // Clear any streaming message first
    clearLawyerStream('home_chat_ai');

    // Add the final message
    testingMessages = [...testingMessages, {
      id: `lawyer_msg_${Date.now()}`,
      type: 'agent',
      agent: 'home_chat_ai',
      text: message,
      html: marked.parse(message),
      sources: sources,
      messageType: 'response',
      timestamp: new Date().toISOString()
    }];
    scrollToBottom();
  }

  function addTaskSeparator(task) {
    testingMessages = [...testingMessages, {
      id: `task_separator_${task.id}_${Date.now()}`,
      type: 'task_separator',
      task: task,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottom();
  }

  function addConversationEndMarker(task, turns, reason) {
    testingMessages = [...testingMessages, {
      id: `task_end_${task.id}_${Date.now()}`,
      type: 'task_end',
      task: task,
      turns: turns,
      reason: reason,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottom();
  }

  function addSystemMessage(text, level = 'info') {
    messages = [...messages, {
      id: Date.now(),
      type: 'system',
      text,
      level,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottom();
  }

  function addAgentMessage(agent, text, messageType = 'info') {
    messages = [...messages, {
      id: Date.now(),
      type: 'agent',
      agent,
      text,
      messageType,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottom();
  }

  function addAgentMessageWithReasoning(agent, text, messageType = 'info', reasoning = null) {
    messages = [...messages, {
      id: Date.now(),
      type: 'agent',
      agent,
      text,
      messageType,
      reasoning,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottom();
  }

  function addTestingMessage(agent, text, messageType = 'info') {
    console.log(`[FRONTEND] Adding testing message - Agent: ${agent}, Type: ${messageType}, Text: ${text.substring(0, 50)}...`);
    testingMessages = [...testingMessages, {
      id: `${agent}_${Date.now()}`,
      type: 'agent',
      agent,
      text,
      html: marked.parse(text),
      messageType,
      timestamp: new Date().toLocaleTimeString()
    }];
    console.log(`[FRONTEND] Total testing messages: ${testingMessages.length}`);
    scrollToBottomTesting();
  }

  function addTestingMessageWithReasoning(agent, text, messageType = 'info', reasoning = null) {
    testingMessages = [...testingMessages, {
      id: `${agent}_${Date.now()}`,
      type: 'agent',
      agent,
      text,
      html: marked.parse(text),
      messageType,
      reasoning,
      timestamp: new Date().toLocaleTimeString()
    }];
    scrollToBottomTesting();
  }

  function toggleReasoning(messageId) {
    if (expandedReasonings.has(messageId)) {
      expandedReasonings.delete(messageId);
    } else {
      expandedReasonings.add(messageId);
    }
    expandedReasonings = new Set(expandedReasonings);
  }

  function toggleTask(taskId) {
    if (expandedTasks.has(taskId)) {
      expandedTasks.delete(taskId);
    } else {
      expandedTasks.add(taskId);
    }
    expandedTasks = new Set(expandedTasks);
  }

  // Group testing messages by task
  let groupedTaskMessages = $derived(() => {
    const groups = [];
    let currentGroup = null;

    console.log(`[FRONTEND] Grouping ${testingMessages.length} testing messages`);

    for (const message of testingMessages) {
      if (message.type === 'task_separator') {
        // Start a new task group
        console.log(`[FRONTEND] Starting new task group: ${message.task.description}`);
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          task: message.task,
          messages: [],
          turns: 0,
          reason: null
        };
      } else if (message.type === 'task_end') {
        // End the current task group
        console.log(`[FRONTEND] Ending task group with ${message.turns} turns`);
        if (currentGroup) {
          currentGroup.turns = message.turns;
          currentGroup.reason = message.reason;
        }
      } else {
        // Add message to current group
        if (currentGroup) {
          console.log(`[FRONTEND] Adding message to group - Agent: ${message.agent}, Type: ${message.type}`);
          currentGroup.messages.push(message);
        } else {
          console.log(`[FRONTEND] WARNING: Message without group - Agent: ${message.agent}, Type: ${message.type}`);
        }
      }
    }

    // Add the last group if it exists
    if (currentGroup) {
      console.log(`[FRONTEND] Adding final group with ${currentGroup.messages.length} messages`);
      groups.push(currentGroup);
    }

    console.log(`[FRONTEND] Total groups: ${groups.length}`);
    return groups;
  });

  function scrollToBottom() {
    setTimeout(() => {
      const container = document.getElementById('messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  function scrollToBottomTesting() {
    setTimeout(() => {
      const container = document.getElementById('testing-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  function sendMessage() {
    if (!userInput.trim() || !connected || isProcessing) return;

    const message = userInput.trim();
    userInput = '';

    addSystemMessage(`You: ${message}`, 'user');

    ws.send(JSON.stringify({
      type: 'user_input',
      message: message,
      agentType: selectedAgentType,
      country: selectedCountry
    }));

    isProcessing = true;
    tasks = [];
  }

  function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function getAgentColor(agent) {
    const colors = {
      'task_creator': '#3b82f6',
      'task_executor': '#10b981',
      'home_chat_ai': '#8b5cf6'
    };
    return colors[agent] || '#6b7280';
  }

  function getAgentName(agent) {
    const names = {
      'task_creator': 'Task Creator',
      'task_executor': 'Task Executor',
      'home_chat_ai': 'Lawyer AI'
    };
    return names[agent] || agent;
  }

  onMount(() => {
    connectWebSocket();
  });

  onDestroy(() => {
    if (ws) {
      ws.close();
    }
  });
</script>

<main>
  <div class="container" class:split={showTestingPanel}>
    <div class="left-panel" class:shrink={showTestingPanel}>
      {#if tasks.length > 0}
        <div class="tasks-panel">
          <h2>Current Tasks ({tasks.length})</h2>
          <div class="tasks-list">
            {#each tasks as task, idx}
              <div class="task-item">
                <span class="task-number">{idx + 1}</span>
                <span class="task-description">{task.description}</span>
                <span class="task-priority priority-{task.priority}">{task.priority}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="messages-panel">
        <div id="messages-container" class="messages-container">
          {#each messages as message}
            {#if message.type === 'system'}
              <div class="message system-message level-{message.level}">
                <span class="timestamp">{message.timestamp}</span>
                <span class="text">{message.text}</span>
              </div>
            {:else if message.type === 'tool_call'}
              <div class="message tool-call-message">
                <div class="tool-call-header">
                  <span class="tool-icon">🔍</span>
                  <span class="tool-name">Lawyer AI is searching for legal information</span>
                  <span class="timestamp">{message.timestamp}</span>
                </div>
                <div class="tool-call-query">
                  <strong>Search Query:</strong> {message.query}
                </div>
              </div>
            {:else if message.type === 'agent'}
              <div class="message agent-message">
                <div class="agent-header" style="border-left-color: {getAgentColor(message.agent)}">
                  <span class="agent-name">{getAgentName(message.agent)}</span>
                  <span class="timestamp">{message.timestamp}</span>
                  {#if message.reasoning}
                    <button
                      class="reasoning-toggle"
                      onclick={() => toggleReasoning(message.id)}
                      class:expanded={expandedReasonings.has(message.id)}
                    >
                      <span class="reasoning-icon">💭</span>
                      <span class="reasoning-label">Reasoning</span>
                      <span class="reasoning-arrow">{expandedReasonings.has(message.id) ? '▼' : '▶'}</span>
                    </button>
                  {/if}
                </div>
                <div class="message-content type-{message.messageType}">
                  {#if message.agent === 'task_executor'}
                    <div class="message-with-label">
                      <span class="message-label">Tester:</span>
                      <div class="message-text">
                        {#if message.html}
                          {@html message.html}
                        {:else}
                          {message.text}
                        {/if}
                      </div>
                    </div>
                  {:else}
                    {#if message.html}
                      {@html message.html}
                    {:else}
                      {message.text}
                    {/if}
                  {/if}
                </div>
                {#if message.sources && message.sources.length > 0}
                  <div class="sources-section">
                    <div class="sources-header">
                      <span class="sources-icon">📚</span>
                      <span class="sources-title">Sources ({message.sources.length}):</span>
                    </div>
                    <div class="sources-list">
                      {#each message.sources as source, i}
                        <div class="source-item">
                          <span class="source-number">{i + 1}.</span>
                          {#if typeof source === 'string'}
                            <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
                          {:else if source.url}
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              {source.title || source.url}
                            </a>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if message.reasoning && expandedReasonings.has(message.id)}
                  <div class="reasoning-content">
                    <div class="reasoning-header">
                      <span class="reasoning-title">Agent Reasoning:</span>
                    </div>
                    <div class="reasoning-text">{message.reasoning}</div>
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="input-panel">
        <div class="selectors-row">
          <div class="selector-group">
            <label for="agent-type">Agent Type:</label>
            <select id="agent-type" bind:value={selectedAgentType} disabled={isProcessing}>
              <option value="home_chat">Home Chat AI</option>
              <option value="case_ai">Case AI</option>
            </select>
          </div>
          <div class="selector-group">
            <label for="country">Country:</label>
            <select id="country" bind:value={selectedCountry} disabled={isProcessing}>
              <option value="UK">UK</option>
              <option value="USA">USA</option>
              <option value="CANADA">Canada</option>
            </select>
          </div>
        </div>
        <div class="input-row">
          <textarea
            bind:value={userInput}
            onkeypress={handleKeyPress}
            placeholder="Enter your request here... (Press Enter to send)"
            disabled={!connected || isProcessing}
            rows="3"
          ></textarea>
          <button
            onclick={sendMessage}
            disabled={!connected || isProcessing || !userInput.trim()}
            class:processing={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </div>
      </div>
    </div>

    {#if showTestingPanel}
      <div class="right-panel" class:visible={showTestingPanel}>
        <div class="panel-header">
          <h2>Lawyer Agent Testing</h2>
          <p>Task Executor ↔ Lawyer AI Conversation</p>
        </div>
        <div id="testing-container" class="testing-container">
          {#each groupedTaskMessages() as taskGroup}
            <div class="task-accordion">
              <button
                class="task-accordion-header"
                onclick={() => toggleTask(taskGroup.task.id)}
                class:expanded={expandedTasks.has(taskGroup.task.id)}
              >
                <div class="task-accordion-icon">
                  {expandedTasks.has(taskGroup.task.id) ? '▼' : '▶'}
                </div>
                <div class="task-accordion-title">
                  <span class="task-number">Task #{taskGroup.task.id}</span>
                  <span class="task-desc">{taskGroup.task.description}</span>
                </div>
                {#if taskGroup.turns > 0}
                  <div class="task-accordion-badge">
                    {taskGroup.turns} turn{taskGroup.turns > 1 ? 's' : ''}
                  </div>
                {/if}
                <div class="task-accordion-status">
                  {taskGroup.reason ? '✓' : '⏳'}
                </div>
              </button>

              {#if expandedTasks.has(taskGroup.task.id)}
                <div class="task-accordion-content">
                  {#each taskGroup.messages as message}
                    {#if message.type === 'tool_call'}
                      <div class="conversation-message tool-call">
                        <div class="tool-call-indicator">
                          <span class="tool-icon">🔍</span>
                          <span class="tool-text">Lawyer AI is searching for legal information...</span>
                        </div>
                        <div class="tool-query">
                          <strong>Query:</strong> {message.query}
                        </div>
                      </div>
                    {:else}
                      <div class="conversation-message" class:tester={message.agent === 'task_executor'} class:lawyer={message.agent === 'home_chat_ai'}>
                        <div class="conversation-label">
                          {message.agent === 'task_executor' ? 'Tester:' : 'Lawyer:'}
                        </div>
                        <div class="conversation-content">
                          {#if message.html}
                            {@html message.html}
                          {:else}
                            {message.text}
                          {/if}
                        </div>
                        {#if message.sources && message.sources.length > 0}
                          <div class="conversation-sources">
                            <div class="sources-header-small">
                              <span class="sources-icon-small">📚</span>
                              <span>Sources ({message.sources.length}):</span>
                            </div>
                            <div class="sources-list-small">
                              {#each message.sources as source, i}
                                <div class="source-item-small">
                                  <span>{i + 1}.</span>
                                  {#if typeof source === 'string'}
                                    <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
                                  {:else if source.url}
                                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                                      {source.title || source.url}
                                    </a>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  {/each}

                  {#if taskGroup.reason}
                    <div class="task-completion-footer">
                      <span class="completion-icon">✓</span>
                      <span class="completion-text">Task completed</span>
                      <span class="completion-reason">{taskGroup.reason}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</main>

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(html) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #0a0e14;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: fixed;
    top: 0;
    left: 0;
  }

  main {
    padding: 0;
    margin: 0;
    width: 100%;
    height: 100%;
    position: fixed;
    top: 0;
    left: 0;
  }

  .container {
    background: #0a0e14;
    overflow: hidden;
    display: flex;
    flex-direction: row;
    height: 100%;
    width: 100%;
    position: absolute;
    top: 0;
    left: 0;
  }

  .left-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    width: 100%;
    transition: width 0.4s ease;
    position: relative;
    overflow: hidden;
  }

  .left-panel.shrink {
    width: 50%;
  }

  .right-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    width: 50%;
    background: #0a0e14;
    border-left: 2px solid #3d2a2f;
    transform: translateX(100%);
    transition: transform 0.4s ease;
    position: absolute;
    right: 0;
    top: 0;
  }

  .right-panel.visible {
    transform: translateX(0);
  }

  .panel-header {
    padding: 16px 30px;
    background: #2d1a1f;
    border-bottom: 1px solid #3d2a2f;
    flex-shrink: 0;
  }

  .panel-header h2 {
    margin: 0 0 4px 0;
    font-size: 16px;
    color: #d4a574;
    font-weight: 600;
  }

  .panel-header p {
    margin: 0;
    font-size: 11px;
    color: #8a7a7e;
  }

  .testing-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 30px;
  }

  .testing-message {
    margin-bottom: 12px;
  }

  .task-accordion {
    margin-bottom: 16px;
    border: 1px solid #3d2a2f;
    border-radius: 8px;
    background: #1a1520;
    overflow: hidden;
  }

  .task-accordion-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    background: #2d1a1f;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #d4a574;
    font-family: inherit;
    font-size: 13px;
  }

  .task-accordion-header:hover {
    background: #3d2a2f;
  }

  .task-accordion-header.expanded {
    background: #3d2a2f;
    border-bottom: 1px solid #4d3a3f;
  }

  .task-accordion-icon {
    font-size: 10px;
    color: #b8a8a0;
    transition: transform 0.3s ease;
    flex-shrink: 0;
  }

  .task-accordion-title {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
  }

  .task-number {
    font-weight: 700;
    color: #e8d8d0;
    font-size: 12px;
  }

  .task-desc {
    color: #b8a8a0;
    font-size: 12px;
    font-weight: 400;
  }

  .task-accordion-badge {
    padding: 4px 10px;
    background: #4a3a5f;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 600;
    color: #c8b8c0;
    flex-shrink: 0;
  }

  .task-accordion-status {
    font-size: 16px;
    flex-shrink: 0;
  }

  .task-accordion-content {
    padding: 16px;
    background: #0a0e14;
    animation: accordionSlide 0.3s ease-out;
  }

  /* Conversation Message Styles */
  .conversation-message {
    margin-bottom: 16px;
    padding: 12px;
    border-radius: 6px;
    background: #2d1a1f;
    border-left: 3px solid #4d3a3f;
  }

  .conversation-message.tester {
    border-left-color: #6a7a8a;
    background: linear-gradient(135deg, #1f2a35 0%, #1a1520 100%);
  }

  .conversation-message.lawyer {
    border-left-color: #7a6a5a;
    background: linear-gradient(135deg, #2a1f25 0%, #1a1520 100%);
  }

  .conversation-message.tool-call {
    border-left-color: #7a6a8f;
    background: linear-gradient(135deg, #2a1f35 0%, #1a1520 100%);
  }

  .conversation-label {
    font-size: 11px;
    font-weight: 700;
    color: #d4a574;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
  }

  .conversation-message.tester .conversation-label {
    color: #8a9aaa;
  }

  .conversation-message.lawyer .conversation-label {
    color: #d4a574;
  }

  .conversation-content {
    font-size: 12px;
    line-height: 1.6;
    color: #c8b8c0;
  }

  .tool-call-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .tool-text {
    font-size: 11px;
    font-weight: 600;
    color: #9a8a9f;
  }

  .tool-query {
    font-size: 11px;
    line-height: 1.5;
    color: #b8a8a0;
    padding: 8px;
    background: #1a1520;
    border-radius: 4px;
  }

  .tool-query strong {
    color: #d4a574;
  }

  .conversation-sources {
    margin-top: 12px;
    padding: 10px;
    background: #1a1520;
    border-radius: 4px;
    border-left: 2px solid #4a7a6a;
  }

  .sources-header-small {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #8a9a8f;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .sources-icon-small {
    font-size: 12px;
  }

  .sources-list-small {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .source-item-small {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    font-size: 10px;
    line-height: 1.4;
  }

  .source-item-small span {
    color: #8a9a8f;
    font-weight: 600;
    min-width: 16px;
  }

  .source-item-small a {
    color: #7a9a8a;
    text-decoration: none;
    word-break: break-all;
  }

  .source-item-small a:hover {
    color: #9abaa9;
    text-decoration: underline;
  }

  @keyframes accordionSlide {
    from {
      opacity: 0;
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
    }
    to {
      opacity: 1;
      max-height: 5000px;
      padding-top: 16px;
      padding-bottom: 16px;
    }
  }

  .task-completion-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    padding: 12px 16px;
    background: #1a2520;
    border-left: 3px solid #4a7c59;
    border-radius: 4px;
  }

  .completion-icon {
    font-size: 16px;
    color: #4a7c59;
  }

  .completion-text {
    font-weight: 600;
    color: #6a9c79;
    font-size: 12px;
  }

  .completion-reason {
    flex: 1;
    color: #8aac99;
    font-size: 11px;
    font-style: italic;
  }

  .testing-container::-webkit-scrollbar {
    width: 6px;
  }

  .testing-container::-webkit-scrollbar-track {
    background: #1a1520;
  }

  .testing-container::-webkit-scrollbar-thumb {
    background: #3d2a2f;
    border-radius: 3px;
  }

  .testing-container::-webkit-scrollbar-thumb:hover {
    background: #4d3a3f;
  }

  .tasks-panel {
    padding: 14px 30px;
    background: #2d1a1f;
    border-bottom: 1px solid #3d2a2f;
    max-height: 200px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .tasks-panel::-webkit-scrollbar {
    width: 6px;
  }

  .tasks-panel::-webkit-scrollbar-track {
    background: #1a1520;
  }

  .tasks-panel::-webkit-scrollbar-thumb {
    background: #3d2a2f;
    border-radius: 3px;
  }

  .tasks-panel::-webkit-scrollbar-thumb:hover {
    background: #4d3a3f;
  }

  .tasks-panel h2 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: #d4a574;
    font-weight: 600;
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: #1a1520;
    border-radius: 4px;
    border-left: 2px solid #d4a574;
    border: 1px solid #2d1a1f;
  }

  .task-number {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #d4a574;
    color: #0a0e14;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    flex-shrink: 0;
  }

  .task-description {
    flex: 1;
    font-size: 12px;
    color: #b8a8a0;
  }

  .task-priority {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .priority-high {
    background: #3d2a2f;
    color: #d4a574;
    border: 1px solid #4d3a3f;
  }

  .priority-medium {
    background: #2d1a1f;
    color: #b8a8a0;
    border: 1px solid #3d2a2f;
  }

  .priority-low {
    background: #1a1520;
    color: #8a7a7e;
    border: 1px solid #2d1a1f;
  }

  .messages-panel {
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #0a0e14;
  }

  .messages-container {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 30px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .messages-container::-webkit-scrollbar {
    width: 6px;
  }

  .messages-container::-webkit-scrollbar-track {
    background: #1a1520;
  }

  .messages-container::-webkit-scrollbar-thumb {
    background: #3d2a2f;
    border-radius: 3px;
  }

  .messages-container::-webkit-scrollbar-thumb:hover {
    background: #4d3a3f;
  }

  .message {
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
  }

  .system-message {
    background: #1a1520;
    color: #8a7a7e;
    display: flex;
    gap: 10px;
    align-items: center;
    border: 1px solid #2d1a1f;
  }

  .system-message.level-error {
    background: #2d1a1f;
    color: #d4a574;
    border-color: #3d2a2f;
  }

  .system-message.level-warning {
    background: #2d1a1f;
    color: #d4a574;
    border-color: #3d2a2f;
  }

  .system-message.level-success {
    background: #1a1520;
    color: #b8a8a0;
    border-color: #2d1a1f;
  }

  .system-message.level-user {
    background: #2d1a1f;
    color: #b8a8a0;
    border-color: #3d2a2f;
  }

  .agent-message {
    background: #1a1520;
    border: 1px solid #2d1a1f;
    padding: 0;
    overflow: hidden;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .agent-header {
    padding: 6px 12px;
    background: #2d1a1f;
    border-left: 2px solid #4d3a3f;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .reasoning-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: #3d2a2f;
    border: 1px solid #4d3a3f;
    border-radius: 12px;
    color: #b8a8a0;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    margin-left: auto;
  }

  .reasoning-toggle:hover {
    background: #4d3a3f;
    border-color: #5d4a4f;
    transform: translateY(-1px);
  }

  .reasoning-toggle.expanded {
    background: #4a3a5f;
    border-color: #6a5a7f;
  }

  .reasoning-icon {
    font-size: 12px;
  }

  .reasoning-label {
    font-weight: 600;
  }

  .reasoning-arrow {
    font-size: 8px;
    transition: transform 0.3s ease;
  }

  .reasoning-content {
    margin-top: 8px;
    padding: 12px;
    background: #1a1520;
    border-left: 3px solid #6a5a7f;
    border-radius: 4px;
    animation: slideDown 0.3s ease-out;
    overflow: hidden;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      max-height: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      max-height: 500px;
      transform: translateY(0);
    }
  }

  .reasoning-header {
    margin-bottom: 8px;
  }

  .reasoning-title {
    font-size: 11px;
    font-weight: 600;
    color: #9a8a9f;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .reasoning-text {
    color: #c8b8c0;
    font-size: 12px;
    line-height: 1.6;
    font-style: italic;
  }

  /* Tool Call Message Styles */
  .tool-call-message {
    padding: 12px 16px;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #2a1f35 0%, #1a1520 100%);
    border-left: 3px solid #7a6a8f;
    border-radius: 6px;
    animation: slideIn 0.3s ease-out;
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .tool-icon {
    font-size: 16px;
  }

  .tool-name {
    font-size: 12px;
    font-weight: 600;
    color: #9a8a9f;
    flex: 1;
  }

  .tool-call-query {
    font-size: 11px;
    line-height: 1.6;
    color: #b8a8a0;
    padding: 8px 12px;
    background: #1a1520;
    border-radius: 4px;
    margin-top: 6px;
  }

  .tool-call-query strong {
    color: #d4a574;
    font-weight: 600;
  }

  /* Sources Section Styles */
  .sources-section {
    margin-top: 12px;
    padding: 12px;
    background: #1a1520;
    border-left: 3px solid #4a7a6a;
    border-radius: 4px;
  }

  .sources-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .sources-icon {
    font-size: 14px;
  }

  .sources-title {
    font-size: 11px;
    font-weight: 600;
    color: #8a9a8f;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .sources-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .source-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 11px;
    line-height: 1.5;
  }

  .source-number {
    color: #8a9a8f;
    font-weight: 600;
    min-width: 20px;
  }

  .source-item a {
    color: #7a9a8a;
    text-decoration: none;
    word-break: break-all;
    transition: color 0.15s;
  }

  .source-item a:hover {
    color: #9abaa9;
    text-decoration: underline;
  }

  .agent-name {
    font-weight: 600;
    color: #b8a8a0;
    font-size: 11px;
  }

  .timestamp {
    font-size: 9px;
    color: #6a5a5e;
  }

  .message-content {
    padding: 10px 12px;
    color: #b8a8a0;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
  }

  .message-with-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .message-label {
    font-size: 11px;
    font-weight: 700;
    color: #8a9aaa;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .message-text {
    font-size: 12px;
    line-height: 1.6;
    color: #c8b8c0;
  }

  .message-content :global(h1),
  .message-content :global(h2),
  .message-content :global(h3) {
    color: #d8c8c0;
    margin: 12px 0 8px 0;
    font-weight: 600;
  }

  .message-content :global(h1) { font-size: 18px; }
  .message-content :global(h2) { font-size: 16px; }
  .message-content :global(h3) { font-size: 14px; }

  .message-content :global(p) {
    margin: 8px 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .message-content :global(code) {
    background: #0d0a10;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #e8d8d0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .message-content :global(pre) {
    background: #0d0a10;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 10px 0;
    max-width: 100%;
  }

  .message-content :global(pre code) {
    background: none;
    padding: 0;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    margin: 8px 0;
    padding-left: 24px;
  }

  .message-content :global(li) {
    margin: 4px 0;
  }

  .message-content :global(strong) {
    font-weight: 600;
    color: #d8c8c0;
  }

  .message-content.type-response {
    background: #1a1520;
    border-top: 1px solid #2d1a1f;
    white-space: pre-wrap;
  }

  .task-separator {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 24px 0;
    padding: 16px 0;
  }

  .separator-line {
    flex: 1;
    height: 2px;
    background: linear-gradient(90deg, transparent, #4d3a3f, transparent);
  }

  .separator-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: #2d1a1f;
    border: 1px solid #4d3a3f;
    border-radius: 20px;
  }

  .separator-icon {
    font-size: 18px;
  }

  .separator-text {
    color: #d8c8c0;
    font-size: 13px;
    font-weight: 500;
  }

  .separator-text strong {
    color: #e8d8d0;
  }

  .task-end-marker {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 0;
    padding: 12px 16px;
    background: #1a2520;
    border-left: 3px solid #4a7c59;
    border-radius: 4px;
  }

  .end-icon {
    font-size: 16px;
    color: #6ab187;
  }

  .end-text {
    color: #b8c8b0;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .end-reason {
    color: #8a9a8a;
    font-size: 11px;
    font-style: italic;
  }

  .message-content.type-task {
    background: #1a1520;
    border-top: 1px solid #2d1a1f;
  }

  .message-content.type-question {
    background: #2d1a1f;
    border-top: 1px solid #3d2a2f;
    font-weight: 500;
    color: #d4a574;
  }

  .message-content.type-task_execution {
    background: #1a1520;
    border-top: 1px solid #2d1a1f;
    white-space: pre-wrap;
  }

  .input-panel {
    padding: 14px 30px;
    background: #2d1a1f;
    border-top: 1px solid #3d2a2f;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }

  .selectors-row {
    display: flex;
    gap: 20px;
    align-items: center;
  }

  .selector-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .selector-group label {
    font-size: 11px;
    color: #b8a8a0;
    font-weight: 600;
  }

  .selector-group select {
    padding: 6px 12px;
    background: #1a1520;
    color: #b8a8a0;
    border: 1px solid #3d2a2f;
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .selector-group select:hover:not(:disabled) {
    border-color: #4d3a3f;
    background: #1a1520;
  }

  .selector-group select:focus {
    outline: none;
    border-color: #4d3a3f;
  }

  .selector-group select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-row {
    display: flex;
    gap: 10px;
  }

  textarea {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #3d2a2f;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    resize: none;
    transition: all 0.15s;
    background: #1a1520;
    color: #b8a8a0;
  }

  textarea::placeholder {
    color: #6a5a5e;
  }

  textarea:focus {
    outline: none;
    border-color: #4d3a3f;
    background: #1a1520;
  }

  textarea:disabled {
    background: #1a1520;
    cursor: not-allowed;
    opacity: 0.5;
  }

  button {
    padding: 10px 24px;
    background: #3d2a2f;
    color: #d4a574;
    border: 1px solid #4d3a3f;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  button:hover:not(:disabled) {
    background: #4d3a3f;
    border-color: #5d4a4f;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  button.processing {
    background: #4d3a3f;
  }
</style>
