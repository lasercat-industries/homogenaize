// Type guards
export function isOpenAIResponse(_response, provider) {
    return provider === 'openai';
}
export function isAnthropicResponse(_response, provider) {
    return provider === 'anthropic';
}
export function isGeminiResponse(_response, provider) {
    return provider === 'gemini';
}
//# sourceMappingURL=types.js.map