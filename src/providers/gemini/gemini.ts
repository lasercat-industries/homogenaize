import { z } from 'zod';
import type { 
  Provider, 
  ChatRequest, 
  ChatResponse, 
  StreamingResponse,
  ProviderCapabilities,
  Tool,
  ToolCall,
  Message
} from '../provider';
import type { 
  TypedProvider, 
  ProviderChatRequest, 
  ProviderChatResponse 
} from '../types';

// Gemini-specific types
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart = 
  | { text: string }
  | { functionCall: { name: string; args: any } }
  | { functionResponse: { name: string; response: any } };

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: any;
  }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    candidateCount?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE';
    };
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason: string;
    index: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Helper to convert Zod schema to Gemini-compatible JSON Schema
function zodToGeminiSchema(schema: z.ZodSchema): any {
  const zodType = schema._def;
  
  function processZodType(def: any): any {
    switch (def.type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array':
        return {
          type: 'array',
          items: processZodType(def.valueType._def)
        };
      case 'object':
        const properties: any = {};
        const required: string[] = [];
        
        // Access shape directly from def
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = processZodType((value as any)._def);
          // Check if field is optional
          if ((value as any)._def.type !== 'optional') {
            required.push(key);
          }
        }
        
        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined
        };
      case 'optional':
        return processZodType(def.innerType._def);
      case 'enum':
        return {
          type: 'string',
          enum: def.values
        };
      case 'literal':
        return {
          type: typeof def.value,
          const: def.value
        };
      default:
        // Fallback for unsupported types
        return { type: 'string' };
    }
  }
  
  return processZodType(zodType);
}

export class GeminiProvider implements TypedProvider<'gemini'> {
  readonly name = 'gemini' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 1048576 // Gemini 1.5 Pro supports up to 1M tokens
  };

  private apiKey: string;
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
  }

  async chat(request: ProviderChatRequest<'gemini'>): Promise<ProviderChatResponse<'gemini'>> {
    const geminiRequest = this.transformRequest(request);
    const model = request.model || 'gemini-1.5-pro-latest';
    
    const response = await fetch(
      `${this.baseURL}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest)
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const data: GeminiResponse = await response.json();
    return this.transformResponse(data, model);
  }

  async stream(request: ProviderChatRequest<'gemini'>): Promise<StreamingResponse> {
    const geminiRequest = this.transformRequest(request);
    const model = request.model || 'gemini-1.5-pro-latest';
    
    const response = await fetch(
      `${this.baseURL}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest)
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
    let finishReason: string | undefined;

    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              // Gemini might prefix lines with "data: " in SSE format
              const jsonStr = line.startsWith('data: ') ? line.slice(6) : line;
              const data: GeminiResponse = JSON.parse(jsonStr);
              
              if (data.candidates && data.candidates[0]) {
                const candidate = data.candidates[0];
                
                // Extract text from parts
                if (candidate.content && candidate.content.parts) {
                  for (const part of candidate.content.parts) {
                    if ('text' in part && part.text) {
                      content += part.text;
                      yield part.text;
                    }
                  }
                }
                
                // Update finish reason
                if (candidate.finishReason) {
                  finishReason = candidate.finishReason;
                }
              }
              
              // Update usage metadata
              if (data.usageMetadata) {
                usage = data.usageMetadata;
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'gemini'>> {
        // Drain any remaining content
        for await (const _ of this) {
          // Just consume
        }

        return {
          content,
          usage: {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.promptTokenCount + usage.candidatesTokenCount
          },
          model,
          finishReason
        };
      }
    };
  }

  supportsFeature(feature: string): boolean {
    return feature in this.capabilities && (this.capabilities as any)[feature] === true;
  }

  private transformRequest(request: ProviderChatRequest<'gemini'>): GeminiRequest {
    // Extract system message if present
    let systemInstruction: GeminiRequest['systemInstruction'];
    const contents: GeminiContent[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction = {
          parts: [{ text: typeof msg.content === 'string' ? msg.content : '' }]
        };
      } else {
        contents.push(this.transformMessage(msg));
      }
    }

    const geminiRequest: GeminiRequest = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      }
    };

    // Handle structured output via schema
    if (request.schema) {
      // For JSON output, set response MIME type
      geminiRequest.generationConfig!.responseMimeType = 'application/json';
    }

    // Handle Gemini-specific features
    if (request.features) {
      if (request.features.safetySettings) {
        geminiRequest.safetySettings = request.features.safetySettings;
      }
    }

    // Handle tools
    if (request.tools) {
      geminiRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ? zodToGeminiSchema(tool.parameters) : { type: 'object', properties: {} }
        }))
      }];
    }

    // Handle tool choice
    if (request.toolChoice) {
      if (request.toolChoice === 'required') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'ANY' }
        };
      } else if (request.toolChoice === 'none') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'NONE' }
        };
      } else if (request.toolChoice === 'auto') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'AUTO' }
        };
      }
    }

    return geminiRequest;
  }

  private transformMessage(message: Message): GeminiContent {
    const role = message.role === 'assistant' ? 'model' : 'user';
    
    if (typeof message.content === 'string') {
      return {
        role,
        parts: [{ text: message.content }]
      };
    }

    // Handle multi-modal content
    const parts: GeminiPart[] = message.content.map(c => {
      if (c.type === 'text') {
        return { text: c.text };
      }
      // Handle image content if needed
      return { text: '[Image content]' };
    });

    return { role, parts };
  }

  private transformResponse(response: GeminiResponse, model: string): ProviderChatResponse<'gemini'> {
    const candidate = response.candidates[0];
    let content = '';
    const toolCalls: ToolCall[] = [];

    // Process content parts
    if (candidate.content && candidate.content.parts) {
      for (let i = 0; i < candidate.content.parts.length; i++) {
        const part = candidate.content.parts[i];
        if ('text' in part && part.text) {
          content += part.text;
        } else if ('functionCall' in part) {
          toolCalls.push({
            id: `${part.functionCall.name}_${i}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args
          });
        }
      }
    }

    const result: ProviderChatResponse<'gemini'> = {
      content,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount,
        outputTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount
      } : {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      model,
      finishReason: candidate.finishReason
    };

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    if (candidate.safetyRatings) {
      result.safetyRatings = candidate.safetyRatings;
    }

    return result;
  }
}