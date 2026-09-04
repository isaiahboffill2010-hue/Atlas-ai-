# Gemini Response Pipeline - Comprehensive Debugging Guide

## Issue
Atlas receives Gemini response but does NOT speak it. Response gets lost somewhere in the pipeline.

## Full Request/Response Flow with Logging

### Frontend: Voice Input → Request
```
User speaks "hi"
    ↓
[VoiceInput] Speech recognition transcribes to "hi"
    ↓
[Atlas] State: listening → thinking
    ↓
[Atlas] Sending request to Claude: hi
    ↓
[askClaude] Sending request to /api/claude: hi
```

### Backend: API Request
```
[Atlas LLM] Processing request with Gemini 2.5 Flash as the brain
    ↓
[Conversations DB] Saved user message to conversation
    ↓
[Gemini] Calling Gemini 2.5 Flash API with 1 messages
    ↓
[Gemini] Full response: {...}
    ↓
[Gemini] Found N parts in response
[Gemini] Found text part: hello...
    ↓
[API] Final response text from Gemini: hello...
[API] Response is empty?: false
    ↓
[API] Returning response to client with text: hello
```

### Frontend: Response Reception
```
[askClaude] Response status: 200
    ↓
[askClaude] Response data: {"content":[{"type":"text","text":"hello"}]}
    ↓
[askClaude] Content array length: 1
    ↓
[askClaude] Found text content: true
    ↓
[askClaude] Returning text: hello
```

### Frontend: Text to Speech
```
[Atlas] Got response from Claude: hello
    ↓
[Atlas] Response type: string
[Atlas] Response length: 5
[Atlas] Response is empty?: false
    ↓
[Atlas] State: thinking → speaking
    ↓
[Atlas] Calling voiceInteraction.speak() with: hello
    ↓
[VoiceInput] Starting ElevenLabs TTS
    ↓
[TTS] Requesting speech synthesis: hello
    ↓
[TTS] API error: (if any)
    ↓
[TTS] Audio received, playing...
    ↓
[TTS] Playing audio
    ↓
[TTS] Audio finished
    ↓
[Atlas] Speaking finished, transitioning back to listening
    ↓
[Atlas] State: speaking → listening
```

---

## What to Look For in Logs

### ✅ Expected Successful Flow
```
[Atlas LLM] Processing request with Gemini 2.5 Flash as the brain
[Gemini] Calling Gemini 2.5 Flash API with 1 messages
[Gemini] Received response from Gemini API
[Gemini] Found 1 parts in response
[Gemini] Found text part: Hello...
[API] Final response text from Gemini: Hello...
[API] Returning response to client with text: Hello
[askClaude] Response status: 200
[askClaude] Response data: {"content":[{"type":"text"...
[askClaude] Found text content: true
[askClaude] Returning text: Hello
[Atlas] Got response from Claude: Hello
[Atlas] Calling voiceInteraction.speak() with: Hello
[VoiceInput] Starting ElevenLabs TTS
[TTS] Requesting speech synthesis: Hello
[TTS] Audio received, playing...
[TTS] Playing audio
[TTS] Audio finished
[Atlas] Speaking finished, transitioning back to listening
```

### ❌ Broken Flow - Response Lost
```
[Gemini] Calling Gemini 2.5 Flash API with 1 messages
[Gemini] Received response from Gemini API
[Gemini] Found N parts in response
[Gemini] Found text part: ...
[API] Final response text from Gemini: ...
[API] Returning response to client with text: ...
[askClaude] Response status: 200
[askClaude] Response data: {...}
❌ [Atlas] Got response from Claude: (EMPTY or missing)
❌ [Atlas] State goes back to listening WITHOUT speaking
```

---

## Where Response Could Be Lost

### 1. Gemini API Response (Server Side)
**Logs:**
```
[Gemini] Full response: {...}
[Gemini] Found N parts in response
[Gemini] Found text part: ...
```

**What to check:**
- Is `candidates` array present in Gemini response?
- Does `candidates[0].content.parts` exist?
- Are there text parts in the parts array?

### 2. API Response Format (Server Side)
**Logs:**
```
[API] Final response text from Gemini: ...
[API] Response is empty?: false
[API] Returning response to client with text: ...
```

**What to check:**
- Is assistantText being extracted correctly?
- Is the response JSON being formatted correctly?
- Look at `JSON.stringify({ content: [{ type: 'text', text: assistantText }] })`

### 3. Response Reception (Frontend - askClaude)
**Logs:**
```
[askClaude] Response status: 200
[askClaude] Response data: {...}
[askClaude] Content array length: N
[askClaude] Found text content: true/false
[askClaude] Returning text: ...
```

**What to check:**
- Is response status 200?
- Is content array being parsed?
- Is text content being found?
- What is being returned?

### 4. Response in Index Component (Frontend)
**Logs:**
```
[Atlas] Got response from Claude: ...
[Atlas] Response type: string
[Atlas] Response length: N
[Atlas] Response is empty?: true/false
[Atlas] Calling voiceInteraction.speak() with: ...
```

**What to check:**
- Is response received?
- Is it a string?
- Is it empty?
- Is speak() being called?

### 5. TTS System (Frontend - lib/voice.ts + lib/tts.ts)
**Logs:**
```
[VoiceInput] Starting ElevenLabs TTS
[TTS] Requesting speech synthesis: ...
[TTS] API error: (if any)
[TTS] Audio received, playing...
[TTS] Playing audio
[TTS] Audio finished
```

**What to check:**
- Is speakText being called?
- Is /api/elevenlabs returning audio?
- Is audio being created and played?
- Are there any TTS errors?

---

## Diagnostic Steps

### Step 1: Start Fresh
```bash
npm run dev
```

Open browser console (F12)

### Step 2: Say "Hey" to enter listening mode
Look for:
```
[Atlas Voice] Starting wake-word detection
```

### Step 3: Say Something Simple
Say "hello"

Check the console for logs in this order:
1. `[askClaude] Sending request to /api/claude`
2. `[Gemini] Calling Gemini 2.5 Flash API`
3. `[API] Returning response to client`
4. `[askClaude] Response status: 200`
5. `[Atlas] Got response from Claude`
6. `[TTS] Requesting speech synthesis`

### Step 4: Note Any Missing Logs
If logs jump from step 3 to step 6 (skipping steps 4-5), the response is being lost in the frontend.
If logs skip step 3 (API not returning), the response is being lost in the backend.

---

## Possible Issues & Solutions

### Issue 1: Gemini Returns Empty Response
**Logs:**
```
[Gemini] No candidates in response
```
or
```
[Gemini] No content parts found
```

**Causes:**
- Gemini API error
- Invalid API key
- Model name incorrect
- Request format wrong

**Check:**
```
console.log('[Gemini] Full response:', JSON.stringify(geminiResponse))
```

### Issue 2: Response Not Being Extracted
**Logs:**
```
[API] Final response text from Gemini: (empty)
[API] Response is empty?: true
```

**Causes:**
- getTextBlock() not finding text
- Response format different than expected
- content.parts not populated

**Check:**
```
console.log('[Gemini] Candidate:', JSON.stringify(candidate))
console.log('[Gemini] Content blocks:', JSON.stringify(content))
```

### Issue 3: Frontend Not Receiving Response
**Logs:**
```
[askClaude] Response status: 200
[askClaude] Response data: (empty or wrong format)
```

**Causes:**
- API returning wrong JSON structure
- Response headers wrong
- Parsing error on frontend

**Check:**
```
console.log('[askClaude] Raw response:', await response.json())
```

### Issue 4: Response Not Triggering TTS
**Logs:**
```
[Atlas] Got response from Claude: (has text)
[Atlas] Calling voiceInteraction.speak() with: ...
[VoiceInput] Starting ElevenLabs TTS (missing)
```

**Causes:**
- voiceInteraction.speak() not executing
- Error thrown and caught
- Promise not resolving

**Check:**
Add error logging in voiceInteraction.speak()

### Issue 5: TTS Request Failing
**Logs:**
```
[TTS] Requesting speech synthesis: ...
[TTS] API error: (error details)
```

**Causes:**
- ElevenLabs API down
- Invalid API key
- Audio endpoint broken
- Request format wrong

**Check:**
- Is /api/elevenlabs working?
- Does it receive text?
- Does it return audio?

### Issue 6: Audio Not Playing
**Logs:**
```
[TTS] Audio received, playing...
[TTS] Play error: (or no onplay log)
```

**Causes:**
- Audio element not created properly
- Browser autoplay policy
- Audio format wrong
- Audio blob creation failed

**Check:**
- Is base64ToBlob() working?
- Is currentAudio.play() resolving?

---

## Key Log Checkpoints

| Checkpoint | Log Message | What It Means |
|-----------|-------------|---------------|
| 1. Gemini Called | `[Gemini] Calling Gemini 2.5 Flash API` | Request being sent ✓ |
| 2. Gemini Response | `[Gemini] Received response from Gemini API` | Response received ✓ |
| 3. Text Extracted | `[Gemini] Found text part: ...` | Text in response ✓ |
| 4. API Returns | `[API] Returning response to client` | API preparing response ✓ |
| 5. Frontend Receives | `[askClaude] Response status: 200` | Response received ✓ |
| 6. Text Found | `[askClaude] Found text content: true` | Content parsed ✓ |
| 7. Response Returned | `[Atlas] Got response from Claude: ...` | Text ready to speak ✓ |
| 8. TTS Called | `[TTS] Requesting speech synthesis` | Speaking initiated ✓ |
| 9. Audio Received | `[TTS] Audio received, playing...` | Audio ready ✓ |
| 10. Audio Playing | `[TTS] Playing audio` | Speaking ✓ |

---

## Quick Troubleshooting Flowchart

```
Does Atlas speak?
    ├─ YES ✓ → Problem solved!
    └─ NO
        ├─ Do you see [TTS] logs?
        │  ├─ YES
        │  │  ├─ Is there a [TTS] error?
        │  │  │  ├─ YES → ElevenLabs/Audio issue
        │  │  │  └─ NO → Audio not playing issue
        │  │  └─ NO → voiceInteraction.speak() not called
        │  └─ NO
        │      ├─ Do you see [askClaude] logs?
        │      │  ├─ YES
        │      │  │  ├─ Is "Found text content" true?
        │      │  │  │  ├─ YES → Response not reaching pages/index
        │      │  │  │  └─ NO → API not returning correct format
        │      │  │  └─ NO → askClaude not called
        │      │  └─ NO → Response not from frontend call
        │      └─ Do you see [Gemini] logs?
        │         ├─ YES → Response lost in API
        │         └─ NO → Gemini not being called (use Claude path)
```

---

## Next Steps After Adding Logs

1. Restart server: `npm run dev`
2. Open browser console (F12)
3. Speak to Atlas
4. Copy all console logs
5. Find the first log that's MISSING or has unexpected value
6. That's where the response is being lost
7. Focus debugging there

---

**Status: Ready for diagnostic logging. Start Atlas and check the logs at each checkpoint.**
