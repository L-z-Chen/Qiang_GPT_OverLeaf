'use strict';

import { ProjectFile, ProjectContext } from '../types';
import { 
  MAX_LENGTH_PER_FILE_PREVIEW, 
  MAX_LENGTH_MAIN_FILE_PREVIEW, 
  MAX_LENGTH_CURRENT_FILE_PREVIEW,
  MAX_TOTAL_PROJECT_CONTEXT 
} from '../constants';

// Cache for project context to avoid re-scanning on every cursor movement
let projectContextCache: ProjectContext | null = null;
let lastCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds cache

/**
 * Scans the Overleaf project for all .tex files and extracts their content
 * Uses caching to avoid expensive re-scans on every cursor movement
 */
export async function scanProjectFiles(): Promise<ProjectContext> {
  const now = Date.now();
  
  // Return cached context if it's still valid
  if (projectContextCache && (now - lastCacheTime) < CACHE_DURATION) {
    return projectContextCache;
  }
  
  // Clear cache if it's expired
  if (projectContextCache && (now - lastCacheTime) >= CACHE_DURATION) {
    projectContextCache = null;
  }
  
  // Perform the actual scan
  const projectContext = await performProjectScan();
  
  // Cache the result
  projectContextCache = projectContext;
  lastCacheTime = now;
  
  return projectContext;
}

/**
 * Performs the actual project scanning (expensive operation)
 */
async function performProjectScan(): Promise<ProjectContext> {
  const projectFiles: ProjectFile[] = [];
  let currentFile = '';
  let mainDocument: ProjectFile | undefined;

  try {
    // Get the current file name from the editor
    const currentEditor = document.querySelector('.cm-content') as any;
    if (currentEditor?.cmView?.view?.state?.doc?.filename) {
      currentFile = currentEditor.cmView.view.state.doc.filename;
    }

    // Try to find the file tree in Overleaf's UI
    const fileTree = document.querySelector('[data-testid="file-tree"]') || 
                    document.querySelector('.file-tree') ||
                    document.querySelector('.ide-file-tree');
    
    if (fileTree) {
      // Find all .tex files in the file tree
      const texFileElements = fileTree.querySelectorAll('a[href*=".tex"], .file-tree-item[data-path*=".tex"]');
      
      for (const element of texFileElements) {
        const fileName = element.textContent?.trim() || '';
        const filePath = element.getAttribute('href') || element.getAttribute('data-path') || '';
        
        if (fileName.endsWith('.tex')) {
          try {
            // Try to get the file content by opening it in a new editor tab
            const fileContent = await getFileContent(filePath, fileName);
            
            const projectFile: ProjectFile = {
              name: fileName,
              content: fileContent,
              path: filePath
            };
            
            projectFiles.push(projectFile);
            
            // Identify main document (usually main.tex, document.tex, or the first .tex file)
            if (!mainDocument || 
                fileName === 'main.tex' || 
                fileName === 'document.tex' ||
                fileName === 'thesis.tex' ||
                fileName === 'paper.tex') {
              mainDocument = projectFile;
            }
          } catch (error) {
            console.warn(`Failed to read file ${fileName}:`, error);
          }
        }
      }
    }

    // Fallback: try to get files from the project structure API
    if (projectFiles.length === 0) {
      await scanProjectFilesFromAPI(projectFiles);
    }

    // If we still don't have files, try to get the current document content
    if (projectFiles.length === 0) {
      const currentContent = getCurrentDocumentContent();
      if (currentContent) {
        const currentFileName = currentFile || 'main.tex';
        const fallbackFile: ProjectFile = {
          name: currentFileName,
          content: currentContent,
          path: currentFileName
        };
        projectFiles.push(fallbackFile);
        mainDocument = fallbackFile;
      }
    }

  } catch (error) {
    console.error('Error scanning project files:', error);
  }

  return {
    currentFile,
    allTexFiles: projectFiles,
    mainDocument
  };
}

/**
 * Attempts to get file content by simulating opening the file
 */
async function getFileContent(filePath: string, fileName: string): Promise<string> {
  try {
    // Try to find the file in the current DOM if it's already open
    const fileTabs = document.querySelectorAll('.ide-react-panel[data-panel-id*="panel-editor"]');
    
    for (const tab of fileTabs) {
      const tabTitle = tab.querySelector('.ide-react-panel-title')?.textContent;
      if (tabTitle === fileName) {
        const editor = tab.querySelector('.cm-content') as any;
        if (editor?.cmView?.view?.state?.doc) {
          return editor.cmView.view.state.doc.toString();
        }
      }
    }

    // If file is not open, try to open it by clicking on the file tree item
    const fileTreeItem = document.querySelector(`a[href="${filePath}"], .file-tree-item[data-path="${filePath}"]`);
    if (fileTreeItem) {
      // Simulate click to open the file
      (fileTreeItem as HTMLElement).click();
      
      // Wait a bit for the file to load
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try to get the content again
      const newEditor = document.querySelector('.cm-content') as any;
      if (newEditor?.cmView?.view?.state?.doc) {
        return newEditor.cmView.view.state.doc.toString();
      }
    }

    return '';
  } catch (error) {
    console.warn(`Failed to get content for ${fileName}:`, error);
    return '';
  }
}

/**
 * Fallback method to scan files using Overleaf's API
 */
async function scanProjectFilesFromAPI(projectFiles: ProjectFile[]): Promise<void> {
  try {
    // Try to access Overleaf's internal API for project structure
    const projectId = window.location.pathname.split('/').pop();
    if (projectId) {
      // This is a fallback - Overleaf might have internal APIs we can access
      // For now, we'll rely on the DOM-based approach
      console.log('Project ID found:', projectId);
    }
  } catch (error) {
    console.warn('Failed to scan project files from API:', error);
  }
}

/**
 * Gets the content of the currently active document
 */
function getCurrentDocumentContent(): string {
  try {
    const editor = document.querySelector('.cm-content') as any;
    if (editor?.cmView?.view?.state?.doc) {
      return editor.cmView.view.state.doc.toString();
    }
  } catch (error) {
    console.warn('Failed to get current document content:', error);
  }
  return '';
}

/**
 * Creates a summary of all .tex files for the prompt
 */
export function createProjectSummary(projectContext: ProjectContext): string {
  if (projectContext.allTexFiles.length === 0) {
    return '';
  }

  let summary = '### Project Structure ###\n';
  let totalContextLength = 0;
  
  // Sort files by importance: main document first, then current file, then others
  const sortedFiles = [...projectContext.allTexFiles].sort((a, b) => {
    const aIsMain = a === projectContext.mainDocument;
    const bIsMain = b === projectContext.mainDocument;
    const aIsCurrent = a.name === projectContext.currentFile;
    const bIsCurrent = b.name === projectContext.currentFile;
    
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return 0;
  });
  
  for (const file of sortedFiles) {
    const isMain = file === projectContext.mainDocument;
    const isCurrent = file.name === projectContext.currentFile;
    
    // Determine preview length based on file importance
    let previewLength: number;
    if (isMain) {
      previewLength = MAX_LENGTH_MAIN_FILE_PREVIEW;
    } else if (isCurrent) {
      previewLength = MAX_LENGTH_CURRENT_FILE_PREVIEW;
    } else {
      previewLength = MAX_LENGTH_PER_FILE_PREVIEW;
    }
    
    // Check if adding this file would exceed total context limit
    const estimatedFileContext = previewLength + 100; // +100 for formatting
    if (totalContextLength + estimatedFileContext > MAX_TOTAL_PROJECT_CONTEXT) {
      // Skip this file if it would exceed the limit
      continue;
    }
    
    summary += `${isMain ? 'MAIN' : isCurrent ? 'CURRENT' : 'FILE'}: ${file.name}\n`;
    
    // Get the most relevant part of the file content
    let preview: string;
    if (isCurrent) {
      // For current file, get content around the cursor position
      preview = getRelevantContentPreview(file.content, previewLength);
    } else {
      // For other files, get the beginning (usually contains important structure)
      preview = file.content.substring(0, previewLength);
    }
    
    // Clean up the preview
    preview = preview.replace(/\n/g, '\\n').trim();
    summary += `Content preview: ${preview}${file.content.length > previewLength ? '...' : ''}\n\n`;
    
    totalContextLength += preview.length + 100; // +100 for formatting
  }
  
  // Add context usage info
  summary += `[Context used: ${totalContextLength}/${MAX_TOTAL_PROJECT_CONTEXT} characters]\n`;
  
  return summary;
}

/**
 * Gets the most relevant content preview for the current file
 * Tries to get content around the cursor position rather than just the beginning
 */
function getRelevantContentPreview(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  
  // Try to find a good starting point (not just the beginning)
  // Look for the last section or chapter before the end
  const lastSectionIndex = content.lastIndexOf('\\section{');
  const lastChapterIndex = content.lastIndexOf('\\chapter{');
  const lastSubsectionIndex = content.lastIndexOf('\\subsection{');
  
  let startIndex = 0;
  if (lastChapterIndex > 0) {
    startIndex = Math.max(0, lastChapterIndex - 500);
  } else if (lastSectionIndex > 0) {
    startIndex = Math.max(0, lastSectionIndex - 300);
  } else if (lastSubsectionIndex > 0) {
    startIndex = Math.max(0, lastSubsectionIndex - 200);
  }
  
  // Ensure we don't start in the middle of a word or command
  const nextNewline = content.indexOf('\n', startIndex);
  if (nextNewline > startIndex && nextNewline < startIndex + 100) {
    startIndex = nextNewline + 1;
  }
  
  return content.substring(startIndex, startIndex + maxLength);
}

/**
 * Forces a refresh of the project context cache
 * Call this when files are added/removed or when cache is stale
 */
export function invalidateProjectCache(): void {
  projectContextCache = null;
  lastCacheTime = 0;
}

/**
 * Gets cached project context without triggering a scan
 * Returns null if no cache exists or cache is expired
 */
export function getCachedProjectContext(): ProjectContext | null {
  const now = Date.now();
  if (projectContextCache && (now - lastCacheTime) < CACHE_DURATION) {
    return projectContextCache;
  }
  return null;
} 