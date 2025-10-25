import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6335';
const COLLECTION_NAME = 'test_sessions';
const VECTOR_SIZE = 128; // Simple vector size for basic storage

// Initialize Qdrant client
const qdrantClient = new QdrantClient({ url: QDRANT_URL });

/**
 * Wait for Qdrant to be ready with retry logic
 */
async function waitForQdrant(maxRetries = 10, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await qdrantClient.getCollections();
      console.log(`[QDRANT] Connection established`);
      return true;
    } catch (error) {
      console.log(`[QDRANT] Waiting for Qdrant to be ready... (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Qdrant failed to start after maximum retries');
}

/**
 * Initialize the Qdrant collection for test sessions
 */
export async function initializeCollection() {
  try {
    // Wait for Qdrant to be ready
    await waitForQdrant();

    // Check if collection exists
    const collections = await qdrantClient.getCollections();
    const collectionExists = collections.collections.some(
      (col) => col.name === COLLECTION_NAME
    );

    if (!collectionExists) {
      // Create collection with vector configuration
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine'
        },
        optimizers_config: {
          default_segment_number: 2
        },
        replication_factor: 1
      });
      console.log(`[QDRANT] Created collection: ${COLLECTION_NAME}`);
    } else {
      console.log(`[QDRANT] Collection already exists: ${COLLECTION_NAME}`);
    }

    return { success: true };
  } catch (error) {
    console.error('[QDRANT] Error initializing collection:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate a simple random vector for storage (no semantic meaning)
 * Just used to satisfy Qdrant's vector requirement
 */
function generateDummyVector() {
  // Generate a simple random vector
  const vector = new Array(VECTOR_SIZE).fill(0).map(() => Math.random());

  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / (magnitude || 1));
}

/**
 * Save a complete test session to Qdrant
 * Stores everything needed to reconstruct the 3-panel view:
 * - Panel 1 (Left): Task Creator conversation + task completion messages
 * - Panel 2 (Middle): Generated tasks
 * - Panel 3 (Right): Task Executor <-> Lawyer AI conversations with evaluations
 */
export async function saveTestSession(sessionData) {
  try {
    const {
      sessionId,
      agentType,
      country,
      timestamp,
      // Panel 1: Task Creator conversation
      taskCreatorConversation,  // Array of {role: 'user'|'assistant', content: string, timestamp: string}
      // Panel 2: Generated tasks
      generatedTasks,  // Array of {id, description, timestamp}
      // Panel 3: Task execution results
      taskExecutions,  // Array of {taskId, conversation: [{role: 'tester'|'lawyer', content: string, timestamp: string, turn: number}], evaluation: {score, coverage, accuracy, completeness, reasoning}}
      // Overall metrics
      overallScore,
      totalTasks,
      completedTasks,
      averageScore
    } = sessionData;

    // Generate a dummy vector (just for Qdrant storage requirement)
    const vector = generateDummyVector();

    // Prepare complete payload with all data needed for reconstruction
    const payload = {
      // Session metadata
      sessionId,
      agentType,
      country,
      timestamp,

      // Panel 1: Task Creator conversation (complete history)
      taskCreatorConversation: taskCreatorConversation || [],

      // Panel 2: Generated tasks (complete list with metadata)
      generatedTasks: generatedTasks || [],

      // Panel 3: Task executions (complete conversations for each task)
      taskExecutions: taskExecutions || [],

      // Overall metrics
      overallScore: overallScore || 0,
      totalTasks: totalTasks || 0,
      completedTasks: completedTasks || 0,
      averageScore: averageScore || 0,

      // Quick preview text for list view
      preview: {
        agentType,
        country,
        taskCount: totalTasks,
        score: overallScore,
        date: timestamp
      }
    };

    // Insert into Qdrant
    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points: [
        {
          id: sessionId,
          vector: vector,
          payload
        }
      ]
    });

    console.log(`[QDRANT] Saved test session: ${sessionId}`);
    return { success: true, sessionId };
  } catch (error) {
    console.error('[QDRANT] Error saving test session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Retrieve a test session by ID
 */
export async function getTestSession(sessionId) {
  try {
    const result = await qdrantClient.retrieve(COLLECTION_NAME, {
      ids: [sessionId],
      with_payload: true,
      with_vector: false
    });

    if (result.length === 0) {
      return { success: false, error: 'Session not found' };
    }

    return { success: true, session: result[0].payload };
  } catch (error) {
    console.error('[QDRANT] Error retrieving test session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all test sessions with pagination
 */
export async function getAllTestSessions(limit = 50, offset = 0) {
  try {
    const result = await qdrantClient.scroll(COLLECTION_NAME, {
      limit,
      offset,
      with_payload: true,
      with_vector: false
    });

    const sessions = result.points.map(point => ({
      id: point.id,
      ...point.payload
    }));

    return { 
      success: true, 
      sessions,
      hasMore: result.points.length === limit
    };
  } catch (error) {
    console.error('[QDRANT] Error getting all test sessions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Search test sessions by text query (searches in preview text)
 * This is a simple text-based search, not semantic
 */
export async function searchTestSessions(query, limit = 50) {
  try {
    // Get all sessions and filter by text match
    const result = await qdrantClient.scroll(COLLECTION_NAME, {
      limit: 100,
      with_payload: true,
      with_vector: false
    });

    // Simple text search in payload
    const queryLower = query.toLowerCase();
    const filteredSessions = result.points
      .filter(point => {
        const payload = point.payload;
        const searchText = `${payload.agentType} ${payload.country} ${JSON.stringify(payload.generatedTasks)} ${JSON.stringify(payload.taskCreatorConversation)}`.toLowerCase();
        return searchText.includes(queryLower);
      })
      .slice(0, limit)
      .map(point => ({
        id: point.id,
        ...point.payload
      }));

    return { success: true, sessions: filteredSessions };
  } catch (error) {
    console.error('[QDRANT] Error searching test sessions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Filter test sessions by criteria
 */
export async function filterTestSessions(filters, limit = 50) {
  try {
    const { agentType, country, minScore, maxScore, startDate, endDate } = filters;

    // Build Qdrant filter
    const must = [];

    if (agentType) {
      must.push({
        key: 'agentType',
        match: { value: agentType }
      });
    }

    if (country) {
      must.push({
        key: 'country',
        match: { value: country }
      });
    }

    if (minScore !== undefined || maxScore !== undefined) {
      const range = {};
      if (minScore !== undefined) range.gte = minScore;
      if (maxScore !== undefined) range.lte = maxScore;
      
      must.push({
        key: 'overallScore',
        range
      });
    }

    if (startDate || endDate) {
      const range = {};
      if (startDate) range.gte = new Date(startDate).toISOString();
      if (endDate) range.lte = new Date(endDate).toISOString();
      
      must.push({
        key: 'timestamp',
        range
      });
    }

    const result = await qdrantClient.scroll(COLLECTION_NAME, {
      filter: must.length > 0 ? { must } : undefined,
      limit,
      with_payload: true,
      with_vector: false
    });

    const sessions = result.points.map(point => ({
      id: point.id,
      ...point.payload
    }));

    return { success: true, sessions };
  } catch (error) {
    console.error('[QDRANT] Error filtering test sessions:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a test session
 */
export async function deleteTestSession(sessionId) {
  try {
    await qdrantClient.delete(COLLECTION_NAME, {
      wait: true,
      points: [sessionId]
    });

    console.log(`[QDRANT] Deleted test session: ${sessionId}`);
    return { success: true };
  } catch (error) {
    console.error('[QDRANT] Error deleting test session:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get statistics about test sessions
 */
export async function getTestSessionStats() {
  try {
    const collectionInfo = await qdrantClient.getCollection(COLLECTION_NAME);
    
    return {
      success: true,
      stats: {
        totalSessions: collectionInfo.points_count,
        vectorsCount: collectionInfo.vectors_count,
        indexedVectorsCount: collectionInfo.indexed_vectors_count
      }
    };
  } catch (error) {
    console.error('[QDRANT] Error getting stats:', error);
    return { success: false, error: error.message };
  }
}

