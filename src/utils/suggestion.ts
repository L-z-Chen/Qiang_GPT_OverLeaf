'use strict';

import OpenAI, { APIUserAbortError } from 'openai';
import {
  DEFAULT_SUGGESTION_MAX_OUTPUT_TOKEN,
  DEFAULT_MODEL,
} from '../constants';
import { postProcessToken, renderPrompt } from './helper';
import { Options, StreamChunk, TextContent, ProjectContext } from '../types';
import { scanProjectFiles, createProjectSummary, getCachedProjectContext } from './projectScanner';
import { semanticContextManager } from './semanticContext';
import { cursorCache } from './cursorCache';
import { semanticIndex } from './semanticEmbeddings';
import { cursorContextRetriever } from './cursorContextRetriever';

const HOSTED_COMPLETE_URL = 'https://embedding.azurewebsites.net/complete';

// Cache for suggestion prompts to avoid regenerating on every cursor movement
let lastPromptCache: { content: string; projectContext: ProjectContext | null; prompt: string } | null = null;
let lastContentHash = '';
let lastCursorPosition = 0;

// Token budget management (like Cursor)
const TOKEN_BUDGET = {
  baseContext: 1000,    // Project structure summary
  localContext: 800,    // Around cursor
  recentChanges: 200,   // Recent edits
  total: 2000           // Much smaller than before
};

export async function* getSuggestion(content: TextContent, signal: AbortSignal, options: Options):
  AsyncGenerator<StreamChunk, void, unknown> {

  // Update semantic index credentials if API key is provided
  if (options.apiKey) {
    semanticIndex.updateCredentials(options.apiKey, options.apiBaseUrl);
  }

  // Use cached project context to avoid expensive scans
  let projectContext: ProjectContext | null = getCachedProjectContext();
  
  // Only scan if we don't have cached context
  if (!projectContext) {
    try {
      projectContext = await scanProjectFiles();
    } catch (error) {
      console.warn('Failed to scan project files, continuing without project context:', error);
    }
  }

  // Use enhanced CursorContextRetriever for comprehensive context
  const currentFile = projectContext?.currentFile || 'unknown';
  const cursorPosition = content.before.length;
  const query = content.before.slice(-200); // Use recent content as query
  
  const contextBundle = await cursorContextRetriever.getFocusedContext(
    'completion',
    currentFile,
    cursorPosition,
    query
  );

  // Check if we can reuse the last prompt
  const contentHash = hashContent(content.before);
  const contentChanged = lastContentHash !== contentHash;
  
  const canReusePrompt = lastPromptCache !== null && 
                        !contentChanged &&
                        lastPromptCache.projectContext === projectContext;
  
  let prompt: string;
  if (canReusePrompt) {
    prompt = lastPromptCache!.prompt;
  } else {
    // Build prompt using enhanced context
    prompt = await buildEnhancedPrompt(content, options.suggestionPrompt, contextBundle);
    // Cache the prompt
    lastPromptCache = { content: content.before, projectContext, prompt };
    lastContentHash = contentHash;
    lastCursorPosition = content.before.length;
  }

  if (!options.apiKey) {
    try {
      const requestBody: any = { 
        content: content.before, 
        stream: true 
      };
      
      // Add enhanced context if available
      if (contextBundle.project && contextBundle.project.allTexFiles.length > 0 && !canReusePrompt) {
        requestBody.projectContext = createProjectSummary(contextBundle.project);
        requestBody.semanticContext = contextBundle.semantic;
      }

      const response = await fetch(HOSTED_COMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: signal,
      });

      if (!response.ok || response.body === null) {
        yield {
          kind: "error",
          content: "Server is at capacity. Please try again later or use your own OpenAI API key."
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const token = postProcessToken(decoder.decode(value, { stream: true }));
        if (!!token) {
          yield {
            kind: "token",
            content: token,
          };
        }
      }
    } catch (AbortError) {
    }
  } else {
    const openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.apiBaseUrl,
      dangerouslyAllowBrowser: true,
    });

    try {
      const stream = await openai.chat.completions.create(
        {
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          model: options.model ?? DEFAULT_MODEL,
          max_tokens: options.suggestionMaxOutputToken ?? DEFAULT_SUGGESTION_MAX_OUTPUT_TOKEN,
          stream: true,
        },
        { signal: signal }
      );

      for await (const chunk of stream) {
        yield { kind: "token", content: chunk.choices[0]?.delta?.content || '' };
      }
    } catch (error) {
      if (error instanceof APIUserAbortError) {
        return;
      }
      yield { kind: "error", content: "An error occurred while generating the content.\n" + error };
    }
  }
}

/**
 * Simple hash function for content to detect changes
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

async function buildEnhancedPrompt(content: TextContent, template: string | undefined, contextBundle: any): Promise<string> {
  if (!!template) {
    if (template.indexOf('<input>') >= 0)
      return template.replace('<input>', content.before.slice(-1000));

    return renderPrompt(template, content, contextBundle);
  }

  // Build enhanced prompt with comprehensive context
  let prompt = `You are an expert LaTeX writer for ICML papers. `;
  
  // Add semantic context
  if (contextBundle.semantic && contextBundle.semantic.relevantChunks.length > 0) {
    prompt += `\n\n## Relevant Semantic Context\n`;
    for (const chunk of contextBundle.semantic.relevantChunks.slice(0, 5)) {
      prompt += `**${chunk.file} (${chunk.type}):** ${chunk.content.slice(0, 300)}...\n\n`;
    }
  }
  
  // Add related definitions and theorems
  if (contextBundle.semantic.relatedDefinitions.length > 0) {
    prompt += `\n## Related Definitions\n`;
    contextBundle.semantic.relatedDefinitions.slice(0, 2).forEach((def: string) => {
      prompt += `${def.slice(0, 200)}...\n\n`;
    });
  }
  
  if (contextBundle.semantic.relatedTheorems.length > 0) {
    prompt += `\n## Related Theorems\n`;
    contextBundle.semantic.relatedTheorems.slice(0, 2).forEach((thm: string) => {
      prompt += `${thm.slice(0, 200)}...\n\n`;
    });
  }
  
  // Add structural context
  if (contextBundle.structural && contextBundle.structural.outline.sections.length > 0) {
    prompt += `\n## Document Structure\n`;
    contextBundle.structural.outline.sections.slice(0, 5).forEach((section: any) => {
      prompt += `- ${section.title} (Level ${section.level})\n`;
    });
    prompt += `\n`;
  }
  
  // Add project context
  if (contextBundle.project) {
    const projectSummary = createProjectSummary(contextBundle.project);
    prompt += `\n## Project Summary\n${projectSummary}\n`;
  }
  
  // Current context
  const currentSection = extractCurrentSectionFromContext(content.before);
  
  prompt += `\n## Current Context\n`;
  if (currentSection) {
    prompt += `**Section:** ${currentSection}\n`;
  }
  prompt += `**Recent Content:**\n${content.before.slice(-800)}\n\n`;
  
  // ICML guidelines
  prompt += `**Guidelines:** Clear, precise ML language. Mathematical rigor. ICML style.\n\n`;
  
  // Continuation instruction
  const endsWithNewline = content.before.endsWith('\n');
  prompt += endsWithNewline ? 
    `Continue the current paragraph or start new section:\n\n` :
    `Continue with next sentence:\n\n`;
  
  return prompt;
}

function extractCurrentSectionFromContext(context: string): string | null {
  const sectionMatch = context.match(/\\section\{(.*?)\}/g);
  const chapterMatch = context.match(/\\chapter\{(.*?)\}/g);
  
  if (chapterMatch && chapterMatch.length > 0) {
    const lastChapter = chapterMatch[chapterMatch.length - 1];
    return lastChapter.match(/\{(.*?)\}/)?.[1] || null;
  } else if (sectionMatch && sectionMatch.length > 0) {
    const lastSection = sectionMatch[sectionMatch.length - 1];
    return lastSection.match(/\{(.*?)\}/)?.[1] || null;
  }
  
  return null;
}