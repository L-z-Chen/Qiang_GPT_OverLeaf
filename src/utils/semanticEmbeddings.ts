'use strict';

import { ProjectFile, ProjectContext } from '../types';

// Types for semantic embeddings
interface CodeChunk {
  id: string;
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'section' | 'import' | 'definition' | 'theorem' | 'proof' | 'equation';
  embedding: Float32Array;
  lastModified: number;
  metadata: {
    section?: string;
    keywords?: string[];
    complexity?: number;
  };
}

interface EmbeddingResult {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Cursor-like Semantic Index using actual embeddings
 */
export class CursorSemanticIndex {
  private embeddings = new Map<string, Float32Array>();
  private chunkIndex = new Map<string, CodeChunk>();
  private fileChunks = new Map<string, string[]>(); // filePath -> chunkIds
  private embeddingModel = 'text-embedding-3-small'; // OpenAI's latest embedding model
  private apiKey: string | null = null;
  private baseURL: string | null = null;

  constructor(apiKey?: string, baseURL?: string) {
    this.apiKey = apiKey || null;
    this.baseURL = baseURL || null;
  }

  /**
   * Index a file with semantic embeddings
   */
  async indexFile(filePath: string, content: string): Promise<void> {
    console.log(`Indexing file: ${filePath}`);
    
    // Remove existing chunks for this file
    const existingChunks = this.fileChunks.get(filePath) || [];
    existingChunks.forEach(chunkId => {
      this.embeddings.delete(chunkId);
      this.chunkIndex.delete(chunkId);
    });

    // Create new chunks
    const chunks = this.chunkFile(content, filePath);
    
    // Create embeddings for each chunk
    for (const chunk of chunks) {
      try {
        const embedding = await this.createEmbedding(chunk.content);
        chunk.embedding = embedding;
        
        this.embeddings.set(chunk.id, embedding);
        this.chunkIndex.set(chunk.id, chunk);
      } catch (error) {
        console.warn(`Failed to create embedding for chunk ${chunk.id}:`, error);
        // Continue with other chunks
      }
    }

    // Update file mapping
    this.fileChunks.set(filePath, chunks.map(c => c.id));
    
    console.log(`Indexed ${chunks.length} chunks for ${filePath}`);
  }

  /**
   * Find relevant context using semantic similarity
   */
  async findRelevantContext(query: string, limit: number = 5): Promise<CodeChunk[]> {
    if (!this.apiKey) {
      console.warn('No API key provided, falling back to simple text matching');
      return this.findRelevantContextFallback(query, limit);
    }

    try {
      const queryEmbedding = await this.createEmbedding(query);
      
      // Find most similar chunks using cosine similarity
      const similarities: Array<{ id: string; similarity: number }> = [];
      
      for (const [id, embedding] of this.embeddings) {
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);
        similarities.push({ id, similarity });
      }
      
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map(s => this.chunkIndex.get(s.id)!)
        .filter(Boolean);
    } catch (error) {
      console.warn('Failed to find relevant context with embeddings, falling back:', error);
      return this.findRelevantContextFallback(query, limit);
    }
  }

  /**
   * Fallback method when embeddings are not available
   */
  private findRelevantContextFallback(query: string, limit: number): CodeChunk[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const scoredChunks: Array<{ chunk: CodeChunk; score: number }> = [];

    for (const chunk of this.chunkIndex.values()) {
      const chunkWords = chunk.content.toLowerCase().split(/\s+/);
      const commonWords = queryWords.filter(word => chunkWords.includes(word));
      const score = commonWords.length / Math.max(queryWords.length, 1);
      
      if (score > 0.1) { // Minimum relevance threshold
        scoredChunks.push({ chunk, score });
      }
    }

    return scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.chunk);
  }

  /**
   * Create semantic embedding using OpenAI API
   */
  private async createEmbedding(text: string): Promise<Float32Array> {
    if (!this.apiKey) {
      throw new Error('API key required for embeddings');
    }

    const response = await fetch(`${this.baseURL || 'https://api.openai.com'}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: this.embeddingModel,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const result: EmbeddingResult = await response.json();
    return new Float32Array(result.data[0].embedding);
  }

  /**
   * Intelligent file chunking for LaTeX documents
   */
  private chunkFile(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    let currentChunk: string[] = [];
    let startLine = 0;
    let chunkType: CodeChunk['type'] = 'section';
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect chunk boundaries
      if (this.isChunkBoundary(line)) {
        if (currentChunk.length > 0) {
          chunks.push(this.createChunk(
            currentChunk.join('\n'),
            filePath,
            startLine,
            i,
            chunkType,
            currentSection
          ));
        }
        
        // Start new chunk
        currentChunk = [line];
        startLine = i;
        chunkType = this.detectChunkType(line);
        currentSection = this.extractSectionName(line);
      } else {
        currentChunk.push(line);
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(
        currentChunk.join('\n'),
        filePath,
        startLine,
        lines.length,
        chunkType,
        currentSection
      ));
    }

    return chunks;
  }

  private createChunk(
    content: string,
    file: string,
    startLine: number,
    endLine: number,
    type: CodeChunk['type'],
    section: string
  ): CodeChunk {
    return {
      id: `${file}:${startLine}-${endLine}`,
      content,
      file,
      startLine,
      endLine,
      type,
      embedding: new Float32Array(), // Will be filled later
      lastModified: Date.now(),
      metadata: {
        section,
        keywords: this.extractKeywords(content),
        complexity: this.calculateComplexity(content)
      }
    };
  }

  private isChunkBoundary(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith('\\section{') ||
           trimmed.startsWith('\\chapter{') ||
           trimmed.startsWith('\\subsection{') ||
           trimmed.startsWith('\\begin{') ||
           trimmed.startsWith('\\end{') ||
           trimmed.startsWith('\\documentclass') ||
           trimmed.startsWith('\\usepackage') ||
           trimmed.startsWith('\\newtheorem') ||
           trimmed.startsWith('\\theorem') ||
           trimmed.startsWith('\\proof') ||
           trimmed.startsWith('\\equation');
  }

  private detectChunkType(line: string): CodeChunk['type'] {
    const trimmed = line.trim();
    
    if (trimmed.includes('\\documentclass') || trimmed.includes('\\usepackage')) {
      return 'import';
    } else if (trimmed.includes('\\begin{theorem}') || trimmed.includes('\\newtheorem')) {
      return 'theorem';
    } else if (trimmed.includes('\\begin{proof}')) {
      return 'proof';
    } else if (trimmed.includes('\\begin{equation}') || trimmed.includes('\\equation')) {
      return 'equation';
    } else if (trimmed.includes('\\section{') || trimmed.includes('\\chapter{')) {
      return 'section';
    } else if (trimmed.includes('\\begin{definition}')) {
      return 'definition';
    } else {
      return 'section';
    }
  }

  private extractSectionName(line: string): string {
    const sectionMatch = line.match(/\\section\{(.*?)\}/);
    const chapterMatch = line.match(/\\chapter\{(.*?)\}/);
    const subsectionMatch = line.match(/\\subsection\{(.*?)\}/);
    
    return sectionMatch?.[1] || chapterMatch?.[1] || subsectionMatch?.[1] || '';
  }

  private extractKeywords(content: string): string[] {
    // Extract LaTeX-specific keywords and mathematical terms
    const keywords: string[] = [];
    
    // Mathematical symbols and commands
    const mathPatterns = [
      /\\[a-zA-Z]+/g,  // LaTeX commands
      /\\[a-zA-Z]+\{[^}]*\}/g,  // LaTeX commands with arguments
      /\$[^$]+\$/g,  // Inline math
      /\\begin\{[^}]+\}/g,  // Begin environments
      /\\end\{[^}]+\}/g   // End environments
    ];
    
    mathPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        keywords.push(...matches);
      }
    });
    
    // Common mathematical terms
    const mathTerms = content.match(/\b(algorithm|theorem|proof|definition|lemma|corollary|proposition|equation|matrix|vector|function|derivative|integral|sum|product|limit|convergence|optimization|gradient|loss|accuracy|precision|recall|f1|auc|roc|svm|neural|network|deep|learning|machine|learning|regression|classification|clustering|dimensionality|reduction|feature|extraction|preprocessing|normalization|standardization|validation|cross|validation|overfitting|underfitting|bias|variance|regularization|dropout|batch|normalization|activation|relu|sigmoid|tanh|softmax|backpropagation|gradient|descent|adam|sgd|momentum|learning|rate|epoch|batch|size|hyperparameter|tuning|grid|search|random|search|bayesian|optimization)\b/gi);
    
    if (mathTerms) {
      keywords.push(...mathTerms);
    }
    
    return [...new Set(keywords)].slice(0, 20); // Limit to 20 unique keywords
  }

  private calculateComplexity(content: string): number {
    // Simple complexity calculation based on content length and mathematical density
    const lines = content.split('\n');
    const mathLines = lines.filter(line => 
      line.includes('$') || 
      line.includes('\\begin{') || 
      line.includes('\\end{') ||
      line.includes('\\[') ||
      line.includes('\\]')
    ).length;
    
    const totalLines = lines.length;
    const mathDensity = mathLines / Math.max(totalLines, 1);
    const lengthFactor = Math.min(totalLines / 50, 1); // Normalize to 0-1
    
    return (mathDensity * 0.7 + lengthFactor * 0.3); // Weighted complexity score
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Update API credentials
   */
  updateCredentials(apiKey: string, baseURL?: string): void {
    this.apiKey = apiKey;
    this.baseURL = baseURL || null;
  }

  /**
   * Get statistics about the index
   */
  getStats(): { totalChunks: number; totalFiles: number; totalEmbeddings: number } {
    return {
      totalChunks: this.chunkIndex.size,
      totalFiles: this.fileChunks.size,
      totalEmbeddings: this.embeddings.size
    };
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.embeddings.clear();
    this.chunkIndex.clear();
    this.fileChunks.clear();
  }

  /**
   * Remove a specific file from the index
   */
  removeFile(filePath: string): void {
    const chunkIds = this.fileChunks.get(filePath) || [];
    chunkIds.forEach(chunkId => {
      this.embeddings.delete(chunkId);
      this.chunkIndex.delete(chunkId);
    });
    this.fileChunks.delete(filePath);
  }
}

// Global instance
export const semanticIndex = new CursorSemanticIndex(); 