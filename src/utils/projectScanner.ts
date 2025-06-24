'use strict';

import { ProjectFile, ProjectContext } from '../types';

/**
 * Scans the Overleaf project for all .tex files and extracts their content
 */
export async function scanProjectFiles(): Promise<ProjectContext> {
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
  
  for (const file of projectContext.allTexFiles) {
    const isMain = file === projectContext.mainDocument;
    const isCurrent = file.name === projectContext.currentFile;
    
    summary += `${isMain ? 'MAIN' : isCurrent ? 'CURRENT' : 'FILE'}: ${file.name}\n`;
    
    // Include a preview of the file content (first 500 characters)
    const preview = file.content.substring(0, 500).replace(/\n/g, '\\n');
    summary += `Content preview: ${preview}${file.content.length > 500 ? '...' : ''}\n\n`;
  }
  
  return summary;
} 