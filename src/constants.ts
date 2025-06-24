'use strict';

export const LOCAL_STORAGE_KEY_OPTIONS = 'storage-key-options';
export const LOCAL_STORAGE_KEY_API_KEY = 'config-api-key';
export const LOCAL_STORAGE_KEY_BASE_URL = 'config-base-url';
export const LOCAL_STORAGE_KEY_MODEL = 'config-model';

export const DEFAULT_MODEL = 'gpt-3.5-turbo';
export const DEFAULT_SUGGESTION_MAX_OUTPUT_TOKEN = 100;
export const MAX_LENGTH_BEFORE_CURSOR = 5000;
export const MAX_LENGTH_AFTER_CURSOR = 5000;
export const MAX_LENGTH_SELECTION = 20000;

// Project context limits
export const MAX_LENGTH_PER_FILE_PREVIEW = 2000;  // Increased from 500
export const MAX_LENGTH_MAIN_FILE_PREVIEW = 3000;  // More context for main document
export const MAX_LENGTH_CURRENT_FILE_PREVIEW = 2500; // More context for current file
export const MAX_TOTAL_PROJECT_CONTEXT = 15000;    // Total limit for all project context

export const MODELS = ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini"];