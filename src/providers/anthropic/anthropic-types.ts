// Type definitions for Anthropic API responses and internal types

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

export type NormalizedFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export function normalizeAnthropicFinishReason(
  stopReason: AnthropicStopReason | string,
): NormalizedFinishReason | undefined {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      // For unknown stop reasons, return undefined
      return undefined;
  }
}
