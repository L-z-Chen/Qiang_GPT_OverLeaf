'use strict';

import { ProjectFile, ProjectContext } from '../types';
import { semanticIndex } from './semanticEmbeddings';

// Types for the advanced caching system
interface Change {
  type: 'insert' | 'delete' | 'replace';
  startLine: number;
  endLine: number;
  content?: string;
  timestamp: number;
}

interface ContextQuery {
  content: string;
  cursorPosition: number;
  filePath: string;
  projectContext: ProjectContext | null;
}

interface Context {
  relevantChunks: CodeChunk[];
  localContext: string;
  projectSummary: string;
  timestamp: number;
  queryHash: string;
}

interface CodeChunk {
  id: string;
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  vector: number[];
  type: 'function' | 'class' | 'section' | 'import' | 'definition' | 'theorem' | 'proof' | 'equation';
  lastModified: number;
}

interface IncrementalIndex {
  chunks: Map<string, CodeChunk>;
  fileChunks: Map<string, string[]>; // filePath -> chunkIds
  wordFrequency: Map<string, number>;
  lastUpdate: number;
}

interface CacheEntry {
  context: Context;
  lastAccess: number;
  accessCount: number;
}

/**
 * File Watcher for detecting changes in Overleaf
 * Simulates file system watching in browser environment
 */
class FileWatcher {
  private listeners: Map<string, ((filePath: string, changes: Change[]) => void)[]> = new Map();
  private lastContent: Map<string, string> = new Map();
  private pollInterval: number = 2000; // Poll every 2 seconds
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startPolling();
  }

  private startPolling() {
    this.intervalId = setInterval(() => {
      this.checkForChanges();
    }, this.pollInterval);
  }

  private async checkForChanges() {
    // In a real implementation, this would check for actual file changes
    // For now, we'll simulate by checking if content has changed
    // This could be enhanced with Overleaf's real-time collaboration events
  }

  on(event: string, callback: (filePath: string, changes: Change[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private emit(event: string, filePath: string, changes: Change[]) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(filePath, changes));
    }
  }

  // Method to manually trigger file change detection
  triggerFileChange(filePath: string, newContent: string) {
    const oldContent = this.lastContent.get(filePath) || '';
    const changes = this.detectChanges(oldContent, newContent);
    
    if (changes.length > 0) {
      this.lastContent.set(filePath, newContent);
      this.emit('fileChanged', filePath, changes);
    }
  }

  private detectChanges(oldContent: string, newContent: string): Change[] {
    const changes: Change[] = [];
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    // Simple line-by-line diff (could be enhanced with more sophisticated diffing)
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (i >= oldLines.length) {
        // New lines added
        changes.push({
          type: 'insert',
          startLine: i,
          endLine: i,
          content: newLines[i],
          timestamp: Date.now()
        });
      } else if (i >= newLines.length) {
        // Lines deleted
        changes.push({
          type: 'delete',
          startLine: i,
          endLine: i,
          timestamp: Date.now()
        });
      } else if (oldLines[i] !== newLines[i]) {
        // Line modified
        changes.push({
          type: 'replace',
          startLine: i,
          endLine: i,
          content: newLines[i],
          timestamp: Date.now()
        });
      }
    }
    
    return changes;
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

/**
 * Incremental Index for efficient updates
 */
class IncrementalIndex {
  private data: {
    chunks: Map<string, CodeChunk>;
    fileChunks: Map<string, string[]>; // filePath -> chunkIds
    wordFrequency: Map<string, number>;
    lastUpdate: number;
  } = {
    chunks: new Map(),
    fileChunks: new Map(),
    wordFrequency: new Map(),
    lastUpdate: Date.now()
  };

  async updateChunk(filePath: string, change: Change) {
    const chunkIds = this.data.fileChunks.get(filePath) || [];
    
    // Find affected chunks
    const affectedChunks = chunkIds.filter(chunkId => {
      const chunk = this.data.chunks.get(chunkId);
      if (!chunk) return false;
      
      // Check if change affects this chunk
      return change.startLine <= chunk.endLine && change.endLine >= chunk.startLine;
    });

    // Re-index affected chunks
    for (const chunkId of affectedChunks) {
      await this.reindexChunk(chunkId, filePath);
    }

    this.data.lastUpdate = Date.now();
  }

  private async reindexChunk(chunkId: string, filePath: string) {
    // Remove old chunk
    this.data.chunks.delete(chunkId);
    
    // Get updated file content and re-chunk
    // This would need to be implemented based on how we get file content
    // For now, we'll mark it for re-indexing
  }

  getChunks(): CodeChunk[] {
    return Array.from(this.data.chunks.values());
  }

  getWordFrequency(): Map<string, number> {
    return this.data.wordFrequency;
  }

  setChunks(chunks: CodeChunk[]) {
    this.data.chunks.clear();
    this.data.fileChunks.clear();
    
    for (const chunk of chunks) {
      this.data.chunks.set(chunk.id, chunk);
      
      if (!this.data.fileChunks.has(chunk.file)) {
        this.data.fileChunks.set(chunk.file, []);
      }
      this.data.fileChunks.get(chunk.file)!.push(chunk.id);
    }
  }
}

/**
 * Advanced Cursor-like Cache System with Enhanced Incremental Updates
 */
export class CursorCache {
  private fileWatcher: FileWatcher;
  private incrementalIndex: IncrementalIndex;
  private cache: Map<string, CacheEntry> = new Map();
  private maxCacheSize: number = 100;
  private cacheTimeout: number = 300000; // 5 minutes
  private lastContextQuery: ContextQuery | null = null;
  private lastContextResult: Context | null = null;

  constructor() {
    this.fileWatcher = new FileWatcher();
    this.incrementalIndex = new IncrementalIndex();
    this.setupIncrementalUpdates();
  }

  private setupIncrementalUpdates() {
    this.fileWatcher.on('fileChanged', async (filePath: string, changes: Change[]) => {
      console.log(`File changed: ${filePath}`, changes);
      
      // Only re-index changed parts for better performance
      for (const change of changes) {
        await this.incrementalIndex.updateChunk(filePath, change);
      }
      
      // Invalidate related cache entries
      this.invalidateRelatedCache(filePath);
      
      // Clear last context if it's related to the changed file
      if (this.lastContextQuery && this.lastContextQuery.filePath === filePath) {
        this.lastContextQuery = null;
        this.lastContextResult = null;
      }
    });
  }

  private invalidateRelatedCache(filePath: string) {
    const keysToRemove: string[] = [];
    
    for (const [key, entry] of this.cache) {
      // Check if this cache entry is related to the changed file
      const isRelated = entry.context.relevantChunks.some(chunk => chunk.file === filePath);
      if (isRelated) {
        keysToRemove.push(key);
      }
    }
    
    // Remove invalidated entries
    keysToRemove.forEach(key => this.cache.delete(key));
    console.log(`Invalidated ${keysToRemove.length} cache entries for ${filePath}`);
  }

  async getContext(query: ContextQuery): Promise<Context> {
    // Quick check for identical query (common case)
    if (this.lastContextQuery && this.isIdenticalQuery(this.lastContextQuery, query)) {
      return this.lastContextResult!;
    }

    const cacheKey = this.generateCacheKey(query);
    
    // Check if we have cached context
    if (this.cache.has(cacheKey) && !this.isStale(cacheKey)) {
      const entry = this.cache.get(cacheKey)!;
      entry.lastAccess = Date.now();
      entry.accessCount++;
      
      // Update last context for quick access
      this.lastContextQuery = query;
      this.lastContextResult = entry.context;
      
      return entry.context;
    }
    
    // Build new context
    const context = await this.buildContext(query);
    
    // Store in cache
    this.cache.set(cacheKey, {
      context,
      lastAccess: Date.now(),
      accessCount: 1
    });
    
    // Update last context for quick access
    this.lastContextQuery = query;
    this.lastContextResult = context;
    
    // Clean up cache if needed
    this.cleanupCache();
    
    return context;
  }

  private isIdenticalQuery(query1: ContextQuery, query2: ContextQuery): boolean {
    return query1.filePath === query2.filePath &&
           query1.cursorPosition === query2.cursorPosition &&
           query1.content === query2.content &&
           query1.projectContext === query2.projectContext;
  }

  private generateCacheKey(query: ContextQuery): string {
    // Create a more sophisticated hash based on query content and cursor position
    const content = query.content.slice(-300); // Last 300 chars for better context
    const position = query.cursorPosition;
    const filePath = query.filePath;
    const projectHash = query.projectContext ? this.hashString(query.projectContext.mainDocument?.name || '') : 'no-project';
    
    return `${filePath}:${position}:${this.hashString(content)}:${projectHash}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  private isStale(cacheKey: string): boolean {
    const entry = this.cache.get(cacheKey);
    if (!entry) return true;
    
    const now = Date.now();
    return (now - entry.context.timestamp) > this.cacheTimeout;
  }

  private async buildContext(query: ContextQuery): Promise<Context> {
    // Use semantic embeddings for context retrieval with fallback
    let relevantChunks: any[] = [];
    
    try {
      relevantChunks = await semanticIndex.findRelevantContext(query.content.slice(-300), 5);
    } catch (error) {
      console.warn('Failed to get semantic context, using incremental index:', error);
      // Fallback to incremental index
      const allChunks = this.incrementalIndex.getChunks();
      relevantChunks = this.findRelevantChunksFromIndex(allChunks, query.content.slice(-300));
    }
    
    // Convert semantic chunks to our format
    const chunks = relevantChunks.map(chunk => ({
      id: chunk.id,
      content: chunk.content,
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      vector: Array.from(chunk.embedding || []).map(val => Number(val)),
      type: chunk.type,
      lastModified: chunk.lastModified
    }));
    
    // Build local context with better boundaries
    const localContext = this.buildLocalContext(query.content, query.cursorPosition);
    
    // Build project summary
    const projectSummary = this.buildProjectSummary(query.projectContext);
    
    return {
      relevantChunks: chunks,
      localContext,
      projectSummary,
      timestamp: Date.now(),
      queryHash: this.hashString(query.content)
    };
  }

  private findRelevantChunksFromIndex(chunks: CodeChunk[], query: string): CodeChunk[] {
    // Simple TF-IDF based relevance scoring
    const queryWords = query.toLowerCase().split(/\s+/);
    const scoredChunks = chunks.map(chunk => {
      const chunkWords = chunk.content.toLowerCase().split(/\s+/);
      const commonWords = queryWords.filter(word => chunkWords.includes(word));
      const score = commonWords.length / Math.max(queryWords.length, 1);
      return { chunk, score };
    });
    
    return scoredChunks
      .filter(item => item.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.chunk);
  }

  private buildLocalContext(content: string, cursorPosition: number): string {
    // Build context around cursor with better boundaries
    const beforeCursor = content.slice(Math.max(0, cursorPosition - 600));
    const afterCursor = content.slice(cursorPosition, cursorPosition + 200);
    
    // Try to find natural boundaries (line breaks, section markers)
    const beforeLines = beforeCursor.split('\n');
    const afterLines = afterCursor.split('\n');
    
    // Take last 10 lines before cursor and first 5 lines after
    const contextBefore = beforeLines.slice(-10).join('\n');
    const contextAfter = afterLines.slice(0, 5).join('\n');
    
    return contextBefore + contextAfter;
  }

  private buildProjectSummary(projectContext: ProjectContext | null): string {
    if (!projectContext) return '';
    
    const mainFile = projectContext.mainDocument;
    if (!mainFile) return '';
    
    const content = mainFile.content;
    const hasAbstract = content.includes('\\begin{abstract}') || content.includes('\\abstract{');
    const hasIntroduction = content.includes('\\section{Introduction}');
    const hasMethodology = content.includes('\\section{Method}') || content.includes('\\section{Methodology}');
    const hasResults = content.includes('\\section{Results}') || content.includes('\\section{Experiments}');
    const hasConclusion = content.includes('\\section{Conclusion}');
    
    let summary = `Main: ${mainFile.name}`;
    const sections = [];
    if (hasAbstract) sections.push('Abstract');
    if (hasIntroduction) sections.push('Introduction');
    if (hasMethodology) sections.push('Methodology');
    if (hasResults) sections.push('Results');
    if (hasConclusion) sections.push('Conclusion');
    
    if (sections.length > 0) {
      summary += ` (${sections.join(', ')})`;
    }
    
    // Add file count
    if (projectContext.allTexFiles.length > 1) {
      summary += ` | ${projectContext.allTexFiles.length} files`;
    }
    
    return summary;
  }

  private cleanupCache() {
    if (this.cache.size <= this.maxCacheSize) return;
    
    // Remove least recently used entries with access count consideration
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      // Prioritize by access count, then by last access time
      const accessDiff = b[1].accessCount - a[1].accessCount;
      if (accessDiff !== 0) return accessDiff;
      return a[1].lastAccess - b[1].lastAccess;
    });
    
    const toRemove = entries.slice(0, this.cache.size - this.maxCacheSize);
    toRemove.forEach(([key]) => this.cache.delete(key));
    
    console.log(`Cleaned up ${toRemove.length} cache entries`);
  }

  // Method to update chunks from semantic context manager
  updateChunks(chunks: CodeChunk[]) {
    this.incrementalIndex.setChunks(chunks);
  }

  // Method to trigger file change (for testing or manual updates)
  triggerFileChange(filePath: string, newContent: string) {
    this.fileWatcher.triggerFileChange(filePath, newContent);
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      timeout: this.cacheTimeout,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        key: key.slice(0, 50) + '...',
        accessCount: entry.accessCount,
        lastAccess: entry.lastAccess,
        age: Date.now() - entry.context.timestamp
      }))
    };
  }

  // Clear cache (useful for testing or memory management)
  clearCache() {
    this.cache.clear();
    this.lastContextQuery = null;
    this.lastContextResult = null;
    console.log('Cache cleared');
  }

  destroy() {
    this.fileWatcher.destroy();
    this.clearCache();
  }
}

// Global instance
export const cursorCache = new CursorCache(); 