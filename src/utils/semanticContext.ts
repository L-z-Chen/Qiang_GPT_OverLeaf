'use strict';

import { ProjectFile, ProjectContext } from '../types';
import { cursorCache } from './cursorCache';
import { semanticIndex } from './semanticEmbeddings';

// Enhanced chunk structure with LaTeX-specific metadata
interface TexChunk {
  id: string;
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  vector: number[]; // Simple TF-IDF like vector
  type: 'section' | 'subsection' | 'subsubsection' | 'equation' | 'figure' | 'table' | 'citation' | 'definition' | 'theorem' | 'proof' | 'import' | 'abstract' | 'introduction' | 'conclusion';
  lastModified: number;
  metadata: {
    title?: string;
    level?: number;
    filePath: string;
    equationNumber?: string;
    figureNumber?: string;
    tableNumber?: string;
    citationKey?: string;
    environment?: string;
    caption?: string;
  };
}

interface Section {
  title: string;
  content: string;
  level: number;
  startLine: number;
  endLine: number;
}

interface Equation {
  content: string;
  number?: string;
  startLine: number;
  endLine: number;
}

interface Figure {
  content: string;
  caption?: string;
  label?: string;
  startLine: number;
  endLine: number;
}

interface Citation {
  key: string;
  context: string;
  startLine: number;
  endLine: number;
}

interface SemanticIndex {
  chunks: TexChunk[];
  lastUpdate: number;
}

// Global semantic index cache
let semanticIndexCache: SemanticIndex | null = null;
const INDEX_CACHE_DURATION = 60000; // 1 minute cache

/**
 * Advanced LaTeX-aware Code Chunker
 * Intelligently chunks LaTeX files by semantic boundaries
 */
class CodeChunker {
  chunkTexFile(content: string, filePath: string): TexChunk[] {
    const chunks: TexChunk[] = [];
    
    // Chunk by semantic boundaries
    const sections = this.extractSections(content);
    const equations = this.extractEquations(content);
    const figures = this.extractFigures(content);
    const tables = this.extractTables(content);
    const citations = this.extractCitations(content);
    const definitions = this.extractDefinitions(content);
    const theorems = this.extractTheorems(content);
    const proofs = this.extractProofs(content);
    
    // Create chunks with metadata
    for (const section of sections) {
      chunks.push({
        id: `${filePath}:section:${section.title}`,
        content: section.content,
        file: filePath,
        startLine: section.startLine,
        endLine: section.endLine,
        vector: [],
        type: this.getSectionType(section.level),
        lastModified: Date.now(),
        metadata: {
          title: section.title,
          level: section.level,
          filePath
        }
      });
    }
    
    // Add equation chunks
    for (const equation of equations) {
      chunks.push({
        id: `${filePath}:equation:${equation.number || 'unnumbered'}`,
        content: equation.content,
        file: filePath,
        startLine: equation.startLine,
        endLine: equation.endLine,
        vector: [],
        type: 'equation',
        lastModified: Date.now(),
        metadata: {
          filePath,
          equationNumber: equation.number
        }
      });
    }
    
    // Add figure chunks
    for (const figure of figures) {
      chunks.push({
        id: `${filePath}:figure:${figure.label || 'unnamed'}`,
        content: figure.content,
        file: filePath,
        startLine: figure.startLine,
        endLine: figure.endLine,
        vector: [],
        type: 'figure',
        lastModified: Date.now(),
        metadata: {
          filePath,
          figureNumber: figure.label,
          caption: figure.caption
        }
      });
    }
    
    // Add table chunks
    for (const table of tables) {
      chunks.push({
        id: `${filePath}:table:${table.label || 'unnamed'}`,
        content: table.content,
        file: filePath,
        startLine: table.startLine,
        endLine: table.endLine,
        vector: [],
        type: 'table',
        lastModified: Date.now(),
        metadata: {
          filePath,
          tableNumber: table.label,
          caption: table.caption
        }
      });
    }
    
    // Add citation chunks
    for (const citation of citations) {
      chunks.push({
        id: `${filePath}:citation:${citation.key}`,
        content: citation.context,
        file: filePath,
        startLine: citation.startLine,
        endLine: citation.endLine,
        vector: [],
        type: 'citation',
        lastModified: Date.now(),
        metadata: {
          filePath,
          citationKey: citation.key
        }
      });
    }
    
    // Add definition chunks
    for (const def of definitions) {
      chunks.push({
        id: `${filePath}:definition:${def.label || 'unnamed'}`,
        content: def.content,
        file: filePath,
        startLine: def.startLine,
        endLine: def.endLine,
        vector: [],
        type: 'definition',
        lastModified: Date.now(),
        metadata: {
          filePath,
          environment: 'definition',
          title: def.label
        }
      });
    }
    
    // Add theorem chunks
    for (const theorem of theorems) {
      chunks.push({
        id: `${filePath}:theorem:${theorem.label || 'unnamed'}`,
        content: theorem.content,
        file: filePath,
        startLine: theorem.startLine,
        endLine: theorem.endLine,
        vector: [],
        type: 'theorem',
        lastModified: Date.now(),
        metadata: {
          filePath,
          environment: 'theorem',
          title: theorem.label
        }
      });
    }
    
    // Add proof chunks
    for (const proof of proofs) {
      chunks.push({
        id: `${filePath}:proof:${proof.label || 'unnamed'}`,
        content: proof.content,
        file: filePath,
        startLine: proof.startLine,
        endLine: proof.endLine,
        vector: [],
        type: 'proof',
        lastModified: Date.now(),
        metadata: {
          filePath,
          environment: 'proof',
          title: proof.label
        }
      });
    }
    
    return chunks;
  }
  
  extractSections(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split('\n');
    const sectionRegex = /\\(section|subsection|subsubsection|chapter|part)\*?\{([^}]+)\}/g;
    
    let currentSection: Section | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = sectionRegex.exec(line);
      
      if (match) {
        // Save previous section
        if (currentSection) {
          currentSection.endLine = i - 1;
          sections.push(currentSection);
        }
        
        // Start new section
        const level = this.getSectionLevel(match[1]);
        currentSection = {
          title: match[2],
          content: line,
          level,
          startLine: i,
          endLine: i
        };
      } else if (currentSection) {
        currentSection.content += '\n' + line;
      }
    }
    
    // Add final section
    if (currentSection) {
      currentSection.endLine = lines.length - 1;
      sections.push(currentSection);
    }
    
    return sections;
  }
  
  extractEquations(content: string): Equation[] {
    const equations: Equation[] = [];
    const lines = content.split('\n');
    
    // Match equation environments - using multiline approach instead of 's' flag
    const equationRegex = /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g;
    let match;
    
    while ((match = equationRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      // Extract equation number if present
      const labelMatch = match[0].match(/\\label\{([^}]+)\}/);
      const number = labelMatch ? labelMatch[1] : undefined;
      
      equations.push({
        content: match[0],
        number,
        startLine,
        endLine
      });
    }
    
    return equations;
  }
  
  extractFigures(content: string): Figure[] {
    const figures: Figure[] = [];
    const lines = content.split('\n');
    
    // Match figure environments - using multiline approach instead of 's' flag
    const figureRegex = /\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g;
    let match;
    
    while ((match = figureRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      // Extract caption and label
      const captionMatch = match[1].match(/\\caption\{([^}]+)\}/);
      const labelMatch = match[1].match(/\\label\{([^}]+)\}/);
      
      figures.push({
        content: match[0],
        caption: captionMatch ? captionMatch[1] : undefined,
        label: labelMatch ? labelMatch[1] : undefined,
        startLine,
        endLine
      });
    }
    
    return figures;
  }
  
  extractTables(content: string): Figure[] {
    const tables: Figure[] = [];
    
    // Match table environments - using multiline approach instead of 's' flag
    const tableRegex = /\\begin\{(table|tabular|longtable)\*?\}([\s\S]*?)\\end\{\1\*?\}/g;
    let match;
    
    while ((match = tableRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      // Extract caption and label
      const captionMatch = match[2].match(/\\caption\{([^}]+)\}/);
      const labelMatch = match[2].match(/\\label\{([^}]+)\}/);
      
      tables.push({
        content: match[0],
        caption: captionMatch ? captionMatch[1] : undefined,
        label: labelMatch ? labelMatch[1] : undefined,
        startLine,
        endLine
      });
    }
    
    return tables;
  }
  
  extractCitations(content: string): Citation[] {
    const citations: Citation[] = [];
    const lines = content.split('\n');
    
    // Match citation commands
    const citationRegex = /\\(cite|citep|citet|citeauthor|citeyear)\{([^}]+)\}/g;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      
      while ((match = citationRegex.exec(line)) !== null) {
        const keys = match[2].split(',').map(k => k.trim());
        
        for (const key of keys) {
          // Get context around citation
          const contextStart = Math.max(0, i - 2);
          const contextEnd = Math.min(lines.length - 1, i + 2);
          const context = lines.slice(contextStart, contextEnd + 1).join('\n');
          
          citations.push({
            key,
            context,
            startLine: contextStart,
            endLine: contextEnd
          });
        }
      }
    }
    
    return citations;
  }
  
  extractDefinitions(content: string): any[] {
    const definitions: any[] = [];
    
    // Match definition environments - using multiline approach instead of 's' flag
    const defRegex = /\\begin\{(definition|defn|def)\*?\}([\s\S]*?)\\end\{\1\*?\}/g;
    let match;
    
    while ((match = defRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      const labelMatch = match[2].match(/\\label\{([^}]+)\}/);
      
      definitions.push({
        content: match[0],
        label: labelMatch ? labelMatch[1] : undefined,
        startLine,
        endLine
      });
    }
    
    return definitions;
  }
  
  extractTheorems(content: string): any[] {
    const theorems: any[] = [];
    
    // Match theorem environments - using multiline approach instead of 's' flag
    const theoremRegex = /\\begin\{(theorem|lemma|corollary|proposition)\*?\}([\s\S]*?)\\end\{\1\*?\}/g;
    let match;
    
    while ((match = theoremRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      const labelMatch = match[2].match(/\\label\{([^}]+)\}/);
      
      theorems.push({
        content: match[0],
        label: labelMatch ? labelMatch[1] : undefined,
        startLine,
        endLine
      });
    }
    
    return theorems;
  }
  
  extractProofs(content: string): any[] {
    const proofs: any[] = [];
    
    // Match proof environments - using multiline approach instead of 's' flag
    const proofRegex = /\\begin\{proof\*?\}([\s\S]*?)\\end\{proof\*?\}/g;
    let match;
    
    while ((match = proofRegex.exec(content)) !== null) {
      const startLine = content.substring(0, match.index).split('\n').length - 1;
      const endLine = content.substring(0, match.index + match[0].length).split('\n').length - 1;
      
      const labelMatch = match[1].match(/\\label\{([^}]+)\}/);
      
      proofs.push({
        content: match[0],
        label: labelMatch ? labelMatch[1] : undefined,
        startLine,
        endLine
      });
    }
    
    return proofs;
  }
  
  private getSectionLevel(sectionType: string): number {
    switch (sectionType) {
      case 'part': return 0;
      case 'chapter': return 1;
      case 'section': return 2;
      case 'subsection': return 3;
      case 'subsubsection': return 4;
      default: return 2;
    }
  }
  
  private getSectionType(level: number): TexChunk['type'] {
    switch (level) {
      case 0: return 'section';
      case 1: return 'section';
      case 2: return 'section';
      case 3: return 'subsection';
      case 4: return 'subsubsection';
      default: return 'section';
    }
  }
}

/**
 * Semantic Indexing & Vector Search System
 * Now integrates with advanced LaTeX-aware chunking
 */
export class SemanticContextManager {
  private index: SemanticIndex | null = null;
  private lastQuery: string = '';
  private lastResults: TexChunk[] = [];
  private chunker: CodeChunker;

  constructor() {
    this.chunker = new CodeChunker();
  }

  /**
   * 1. Semantic Indexing & Vector Search
   */
  async buildSemanticIndex(projectContext: ProjectContext): Promise<SemanticIndex> {
    const now = Date.now();
    
    // Return cached index if valid
    if (semanticIndexCache && (now - semanticIndexCache.lastUpdate) < INDEX_CACHE_DURATION) {
      return semanticIndexCache;
    }

    const chunks: TexChunk[] = [];
    
    // Index files using advanced chunking
    for (const file of projectContext.allTexFiles) {
      try {
        // Use semantic embeddings if available
        await semanticIndex.indexFile(file.name, file.content);
        
        // Also create advanced chunks for better context
        const fileChunks = this.chunker.chunkTexFile(file.content, file.name);
        chunks.push(...fileChunks);
      } catch (error) {
        console.warn(`Failed to index file ${file.name}:`, error);
        // Fallback to advanced chunking only
        const fileChunks = this.chunker.chunkTexFile(file.content, file.name);
        chunks.push(...fileChunks);
      }
    }

    // Build vectors for chunks
    const allText = chunks.map(c => c.content).join(' ');
    const wordFreq = this.calculateWordFrequency(allText);
    
    for (const chunk of chunks) {
      chunk.vector = this.buildVector(chunk.content, wordFreq);
      chunk.lastModified = now;
    }

    semanticIndexCache = {
      chunks,
      lastUpdate: now
    };

    // Update the CursorCache with new chunks
    const convertedChunks = semanticIndexCache.chunks.map(chunk => ({
      id: chunk.id,
      content: chunk.content,
      file: chunk.file,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      vector: chunk.vector,
      type: this.convertChunkType(chunk.type),
      lastModified: chunk.lastModified
    }));
    cursorCache.updateChunks(convertedChunks);

    return semanticIndexCache;
  }

  /**
   * 3. Context Retrieval System
   */
  async getRelevantContext(query: string, projectContext: ProjectContext, maxResults: number = 5): Promise<TexChunk[]> {
    // Check if we can reuse last results
    if (this.lastQuery === query && this.lastResults.length > 0) {
      return this.lastResults.slice(0, maxResults);
    }

    const index = await this.buildSemanticIndex(projectContext);
    const queryVector = this.buildVector(query, this.calculateWordFrequency(index.chunks.map(c => c.content).join(' ')));
    
    // Calculate semantic similarity
    const scoredChunks = index.chunks.map(chunk => ({
      chunk,
      score: this.cosineSimilarity(queryVector, chunk.vector)
    }));

    // Sort by relevance and filter by type
    const relevantChunks = scoredChunks
      .filter(item => item.score > 0.1) // Minimum similarity threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.chunk);

    // Cache results
    this.lastQuery = query;
    this.lastResults = relevantChunks;

    return relevantChunks;
  }

  /**
   * 4. Incremental Updates & Caching
   */
  invalidateCache(): void {
    semanticIndexCache = null;
    this.lastQuery = '';
    this.lastResults = [];
  }

  /**
   * 5. Smart Triggering
   */
  shouldTriggerContextUpdate(currentContent: string, lastContent: string): boolean {
    // Only update if significant changes occurred
    const contentDiff = this.calculateContentDifference(currentContent, lastContent);
    return contentDiff > 0.3; // 30% change threshold
  }

  private calculateContentDifference(current: string, last: string): number {
    const currentWords = current.split(/\s+/);
    const lastWords = last.split(/\s+/);
    const commonWords = currentWords.filter(word => lastWords.includes(word));
    return 1 - (commonWords.length / Math.max(currentWords.length, lastWords.length));
  }

  // Vector operations for semantic similarity
  private buildVector(text: string, wordFreq: Map<string, number>): number[] {
    const words = text.toLowerCase().split(/\s+/);
    const vector: number[] = [];
    
    for (const [word, freq] of wordFreq) {
      const count = words.filter(w => w === word).length;
      vector.push(count / freq);
    }
    
    return vector;
  }

  private calculateWordFrequency(text: string): Map<string, number> {
    const words = text.toLowerCase().split(/\s+/);
    const freq = new Map<string, number>();
    
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }
    
    return freq;
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private convertChunkType(type: TexChunk['type']): 'function' | 'class' | 'section' | 'import' | 'definition' | 'theorem' | 'proof' | 'equation' {
    switch (type) {
      case 'section':
      case 'subsection':
      case 'subsubsection':
      case 'abstract':
      case 'introduction':
      case 'conclusion':
        return 'section';
      case 'equation':
        return 'equation';
      case 'figure':
      case 'table':
        return 'class'; // Map figures and tables to 'class' type
      case 'citation':
        return 'function'; // Map citations to 'function' type
      case 'definition':
        return 'definition';
      case 'theorem':
        return 'theorem';
      case 'proof':
        return 'proof';
      case 'import':
        return 'import';
      default:
        return 'section';
    }
  }
}

// Global instance
export const semanticContextManager = new SemanticContextManager(); 