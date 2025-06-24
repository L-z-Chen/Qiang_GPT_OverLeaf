'use strict';

import { ProjectContext } from '../types';
import { semanticContextManager } from './semanticContext';
import { cursorCache } from './cursorCache';
import { semanticIndex } from './semanticEmbeddings';

// Enhanced context types for comprehensive retrieval
interface ContextBundle {
  immediate: ImmediateContext;
  semantic: SemanticContext;
  structural: StructuralContext;
  recent: RecentContext;
  project: ProjectContext | null;
}

interface ImmediateContext {
  beforeCursor: string;
  afterCursor: string;
  currentLine: string;
  currentSection: string | null;
  surroundingLines: string[];
  cursorPosition: number;
}

interface SemanticContext {
  relevantChunks: any[];
  similarContent: string[];
  relatedDefinitions: string[];
  relatedTheorems: string[];
  relatedEquations: string[];
}

interface StructuralContext {
  imports: string[];
  exports: string[];
  dependencies: string[];
  outline: DocumentOutline;
  fileStructure: FileStructure;
}

interface RecentContext {
  recentlyEdited: string[];
  recentChanges: Change[];
  lastEdits: Edit[];
}

interface DocumentOutline {
  sections: Section[];
  equations: Equation[];
  figures: Figure[];
  tables: Table[];
  citations: Citation[];
}

interface Section {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
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

interface Table {
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

interface FileStructure {
  totalFiles: number;
  mainFile: string;
  includedFiles: string[];
  bibliographyFiles: string[];
  imageFiles: string[];
}

interface Change {
  type: 'insert' | 'delete' | 'replace';
  startLine: number;
  endLine: number;
  content?: string;
  timestamp: number;
}

interface Edit {
  content: string;
  timestamp: number;
  filePath: string;
}

// Token budget management (inspired by Cursor)
const TOKEN_BUDGET = {
  immediate: 1000,      // Current context around cursor
  semantic: 2000,       // Relevant semantic chunks
  structural: 800,      // File structure and outline
  recent: 400,          // Recent changes
  project: 600,         // Project summary
  total: 4800           // Total budget
};

/**
 * Advanced Context Retriever for Overleaf Copilot
 * Provides comprehensive context retrieval with intelligent prioritization
 */
export class CursorContextRetriever {
  private semanticIndex = semanticIndex;
  private semanticContextManager = semanticContextManager;
  private cursorCache = cursorCache;

  /**
   * Main method to get comprehensive context
   */
  async getRelevantContext(
    currentFile: string,
    cursorPosition: number,
    query: string,
    maxTokens: number = TOKEN_BUDGET.total
  ): Promise<ContextBundle> {
    
    const context: ContextBundle = {
      immediate: this.getImmediateContext(currentFile, cursorPosition),
      semantic: await this.getSemanticContext(query),
      structural: await this.getStructuralContext(currentFile),
      recent: this.getRecentlyEditedContext(),
      project: null
    };
    
    // Prioritize and fit within token budget
    return this.optimizeContext(context, maxTokens);
  }

  /**
   * Get immediate context around cursor
   */
  private getImmediateContext(currentFile: string, cursorPosition: number): ImmediateContext {
    // This would need to be implemented based on how we get current file content
    // For now, we'll return a placeholder structure
    return {
      beforeCursor: '',
      afterCursor: '',
      currentLine: '',
      currentSection: null,
      surroundingLines: [],
      cursorPosition
    };
  }

  /**
   * Get semantic context using advanced chunking
   */
  private async getSemanticContext(query: string): Promise<SemanticContext> {
    try {
      // Use semantic embeddings if available
      const relevantChunks = await this.semanticIndex.findRelevantContext(query, 10);
      
      // Categorize chunks by type
      const definitions = relevantChunks.filter(chunk => chunk.type === 'definition');
      const theorems = relevantChunks.filter(chunk => chunk.type === 'theorem');
      const equations = relevantChunks.filter(chunk => chunk.type === 'equation');
      
      return {
        relevantChunks,
        similarContent: relevantChunks.map(chunk => chunk.content),
        relatedDefinitions: definitions.map(def => def.content),
        relatedTheorems: theorems.map(thm => thm.content),
        relatedEquations: equations.map(eq => eq.content)
      };
    } catch (error) {
      console.warn('Failed to get semantic context:', error);
      return {
        relevantChunks: [],
        similarContent: [],
        relatedDefinitions: [],
        relatedTheorems: [],
        relatedEquations: []
      };
    }
  }

  /**
   * Get structural context (file structure, imports, etc.)
   */
  private async getStructuralContext(currentFile: string): Promise<StructuralContext> {
    const outline = await this.extractDocumentOutline(currentFile);
    const fileStructure = await this.analyzeFileStructure(currentFile);
    
    return {
      imports: this.extractImports(currentFile),
      exports: this.extractExports(currentFile),
      dependencies: await this.getDependencyGraph(currentFile),
      outline,
      fileStructure
    };
  }

  /**
   * Get recently edited context
   */
  private getRecentlyEditedContext(): RecentContext {
    // This would integrate with the file watcher system
    return {
      recentlyEdited: [],
      recentChanges: [],
      lastEdits: []
    };
  }

  /**
   * Extract document outline from LaTeX file
   */
  private async extractDocumentOutline(filePath: string): Promise<DocumentOutline> {
    // This would parse the actual file content
    // For now, return placeholder structure
    return {
      sections: [],
      equations: [],
      figures: [],
      tables: [],
      citations: []
    };
  }

  /**
   * Analyze file structure and dependencies
   */
  private async analyzeFileStructure(filePath: string): Promise<FileStructure> {
    return {
      totalFiles: 1,
      mainFile: filePath,
      includedFiles: [],
      bibliographyFiles: [],
      imageFiles: []
    };
  }

  /**
   * Extract import statements (LaTeX packages, includes)
   */
  private extractImports(filePath: string): string[] {
    // This would parse \usepackage and \include statements
    return [];
  }

  /**
   * Extract export statements (LaTeX doesn't have exports, but could track definitions)
   */
  private extractExports(filePath: string): string[] {
    // Track definitions, theorems, etc. that are "exported"
    return [];
  }

  /**
   * Get dependency graph for the file
   */
  private async getDependencyGraph(filePath: string): Promise<string[]> {
    // Track \include, \input, \bibliography dependencies
    return [];
  }

  /**
   * Optimize context to fit within token budget
   */
  private optimizeContext(context: ContextBundle, maxTokens: number): ContextBundle {
    const optimized = { ...context };
    let currentTokens = this.estimateTokens(context);

    // If we're over budget, start trimming
    if (currentTokens > maxTokens) {
      const excess = currentTokens - maxTokens;
      
      // Priority order: immediate > semantic > structural > recent
      if (excess > 0 && optimized.semantic.relevantChunks.length > 5) {
        optimized.semantic.relevantChunks = optimized.semantic.relevantChunks.slice(0, 5);
        optimized.semantic.similarContent = optimized.semantic.similarContent.slice(0, 3);
      }
      
      if (excess > 0 && optimized.structural.outline.sections.length > 10) {
        optimized.structural.outline.sections = optimized.structural.outline.sections.slice(0, 10);
      }
      
      if (excess > 0 && optimized.recent.recentlyEdited.length > 3) {
        optimized.recent.recentlyEdited = optimized.recent.recentlyEdited.slice(0, 3);
      }
    }

    return optimized;
  }

  /**
   * Estimate token count for context bundle
   */
  private estimateTokens(context: ContextBundle): number {
    let tokens = 0;
    
    // Estimate based on character count (rough approximation)
    const charToTokenRatio = 4; // ~4 characters per token
    
    if (context.immediate.beforeCursor) {
      tokens += context.immediate.beforeCursor.length / charToTokenRatio;
    }
    if (context.immediate.afterCursor) {
      tokens += context.immediate.afterCursor.length / charToTokenRatio;
    }
    
    context.semantic.similarContent.forEach(content => {
      tokens += content.length / charToTokenRatio;
    });
    
    context.structural.outline.sections.forEach(section => {
      tokens += section.content.length / charToTokenRatio;
    });
    
    return Math.ceil(tokens);
  }

  /**
   * Get context for specific query with caching
   */
  async getContextForQuery(
    query: string,
    currentFile: string,
    cursorPosition: number,
    projectContext: ProjectContext | null = null
  ): Promise<ContextBundle> {
    
    // Use CursorCache for intelligent caching
    const cacheQuery = {
      content: query,
      cursorPosition,
      filePath: currentFile,
      projectContext
    };

    try {
      const cachedContext = await this.cursorCache.getContext(cacheQuery);
      
      // Convert cached context to our format
      return {
        immediate: this.getImmediateContext(currentFile, cursorPosition),
        semantic: {
          relevantChunks: cachedContext.relevantChunks || [],
          similarContent: cachedContext.relevantChunks?.map(chunk => chunk.content) || [],
          relatedDefinitions: [],
          relatedTheorems: [],
          relatedEquations: []
        },
        structural: await this.getStructuralContext(currentFile),
        recent: this.getRecentlyEditedContext(),
        project: projectContext
      };
    } catch (error) {
      console.warn('Failed to get cached context, falling back to direct retrieval:', error);
      return this.getRelevantContext(currentFile, cursorPosition, query);
    }
  }

  /**
   * Update context when file changes
   */
  updateContextForFileChange(filePath: string, newContent: string): void {
    // Trigger file change in cursor cache
    this.cursorCache.triggerFileChange(filePath, newContent);
    
    // Invalidate semantic index for this file
    this.semanticContextManager.invalidateCache();
  }

  /**
   * Get focused context for specific task
   */
  async getFocusedContext(
    task: 'completion' | 'improvement' | 'refactoring' | 'documentation',
    currentFile: string,
    cursorPosition: number,
    query: string
  ): Promise<ContextBundle> {
    
    const baseContext = await this.getRelevantContext(currentFile, cursorPosition, query);
    
    // Adjust context based on task
    switch (task) {
      case 'completion':
        // Focus on immediate context and similar patterns
        return {
          ...baseContext,
          semantic: {
            ...baseContext.semantic,
            relevantChunks: baseContext.semantic.relevantChunks.slice(0, 3)
          }
        };
        
      case 'improvement':
        // Include more semantic context for better suggestions
        return {
          ...baseContext,
          semantic: {
            ...baseContext.semantic,
            relevantChunks: baseContext.semantic.relevantChunks.slice(0, 8)
          }
        };
        
      case 'refactoring':
        // Include structural context for understanding dependencies
        return baseContext;
        
      case 'documentation':
        // Focus on structural context and similar documentation patterns
        return {
          ...baseContext,
          semantic: {
            ...baseContext.semantic,
            relevantChunks: baseContext.semantic.relevantChunks.filter(chunk => 
              chunk.type === 'section' || chunk.type === 'definition'
            )
          }
        };
        
      default:
        return baseContext;
    }
  }
}

// Global instance
export const cursorContextRetriever = new CursorContextRetriever(); 