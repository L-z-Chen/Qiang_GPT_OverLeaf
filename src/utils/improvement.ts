'use strict';

import OpenAI, { APIUserAbortError } from 'openai';
import {
  DEFAULT_MODEL,
} from '../constants';
import { postProcessToken, renderPrompt } from './helper';
import { Options, TextContent, StreamChunk, ProjectContext } from '../types';
import { scanProjectFiles, createProjectSummary, getCachedProjectContext } from './projectScanner';

const HOSTED_IMPROVE_URL = 'https://embedding.azurewebsites.net/improve';

export async function getImprovement(content: TextContent, prompt: string, options: Options, signal: AbortSignal) {
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

  if (!options.apiKey) {
    try {
      const requestBody: any = { content: content.selection };
      
      // Add project context if available
      if (projectContext && projectContext.allTexFiles.length > 0) {
        requestBody.projectContext = createProjectSummary(projectContext);
      }

      const response = await fetch(HOSTED_IMPROVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: signal,
      });
      if (!response.ok) {
        return "Server is at capacity. Please select fewer words, try again later or use your own OpenAI API key."
      }
      return postProcessToken((await response.json())["content"])
    } catch (AbortError) {
      return "The request was aborted.";
    }
  } else {
    const openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.apiBaseUrl,
      dangerouslyAllowBrowser: true,
    });

    try {
      const response = await openai.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: buildImprovePrompt(content, prompt, projectContext),
          },
        ],
        model: options.model || DEFAULT_MODEL,
      }, { signal: signal });
      return response.choices[0].message.content ?? '';
    } catch (error) {
      if (error instanceof APIUserAbortError) {
        return "The request was aborted.";
      }
      return "An error occurred while generating the content.\n" + error;
    }
  }
}

export async function* getImprovementStream(content: TextContent, prompt: string, options: Options, signal: AbortSignal):
  AsyncGenerator<StreamChunk, void, unknown> {

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

  if (!options.apiKey) {
    try {
      const requestBody: any = { content: content.selection, stream: true };
      
      // Add project context if available
      if (projectContext && projectContext.allTexFiles.length > 0) {
        requestBody.projectContext = createProjectSummary(projectContext);
      }

      const response = await fetch(HOSTED_IMPROVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: signal,
      });

      if (!response.ok || response.body === null) {
        yield {
          kind: "error",
          content: "Server is at capacity. Please select fewer words, try again later or use your own OpenAI API key."
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
      const stream = await openai.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: buildImprovePrompt(content, prompt, projectContext),
          },
        ],
        model: options.model || DEFAULT_MODEL,
        stream: true,
      }, { signal: signal });

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

function buildImprovePrompt(content: TextContent, template: string, projectContext: ProjectContext | null) {
  if (!!template) {
    if (template.indexOf('<input>') >= 0)
      return template.replace('<input>', content.selection);

    return renderPrompt(template, content, projectContext);
  }

  // Create an integrated improvement prompt for ICML papers
  let prompt = `You are an expert LaTeX editor specializing in ICML (International Conference on Machine Learning) papers. `;
  
  if (projectContext && projectContext.allTexFiles.length > 0) {
    const mainFile = projectContext.mainDocument;
    const currentFile = projectContext.allTexFiles.find(f => f.name === projectContext.currentFile);
    
    prompt += `\n\n## Context Analysis\n`;
    
    if (mainFile) {
      const mainContent = mainFile.content;
      const documentClass = mainContent.match(/\\documentclass\[.*?\]\{(.*?)\}/)?.[1] || 
                           mainContent.match(/\\documentclass\{(.*?)\}/)?.[1] || 'article';
      prompt += `**Document Type:** ${documentClass} (ICML paper)\n`;
    }
    
    if (currentFile) {
      const currentSection = extractCurrentSection(currentFile.content, content.before);
      prompt += `**Current Section:** ${currentSection || 'Unknown'}\n`;
    }
  }
  
  prompt += `\n## Improvement Guidelines for ICML Papers\n`;
  prompt += `- Improve clarity and precision for machine learning audience\n`;
  prompt += `- Ensure mathematical notation is correct and consistent\n`;
  prompt += `- Maintain ICML style: technical but accessible\n`;
  prompt += `- Fix any LaTeX syntax errors\n`;
  prompt += `- Improve flow and readability\n`;
  prompt += `- Ensure proper academic tone and formality\n`;
  
  prompt += `\n## Text to Improve\n`;
  prompt += `${content.selection}\n\n`;
  prompt += `**Improved Version:**`;
  
  return prompt;
}

function extractCurrentSection(content: string, beforeText: string): string | null {
  const beforeIndex = content.indexOf(beforeText);
  if (beforeIndex === -1) return null;
  
  const beforeContent = content.substring(0, beforeIndex);
  const sectionMatch = beforeContent.match(/\\section\{(.*?)\}/g);
  const chapterMatch = beforeContent.match(/\\chapter\{(.*?)\}/g);
  
  if (chapterMatch && chapterMatch.length > 0) {
    const lastChapter = chapterMatch[chapterMatch.length - 1];
    return lastChapter.match(/\{(.*?)\}/)?.[1] || null;
  } else if (sectionMatch && sectionMatch.length > 0) {
    const lastSection = sectionMatch[sectionMatch.length - 1];
    return lastSection.match(/\{(.*?)\}/)?.[1] || null;
  }
  
  return null;
}
