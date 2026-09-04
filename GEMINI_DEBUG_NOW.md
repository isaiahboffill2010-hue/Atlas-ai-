# Gemini Response - Real-Time Debugging

## What's Been Added
Explicit logging at EVERY step of the Gemini→ElevenLabs pipeline.

## How to Test

### 1. Start Fresh
```bash
npm run dev
```

### 2. Open Browser Console
Press `F12` in your browser

### 3. Test Sequence
```
Say: "Hey Atlas"
→ Wait for "Listening"
→ Say: "hi"
→ Watch console logs carefully
```

## Exact Log Sequence to Look For

### ✅ Expected Successful Logs
```
[GEMINI DEBUG] About to call Gemini API
[GEMINI DEBUG] Gemini request completed, status: 200
[GEMINI DEBUG] Raw response text length: XXX
[GEMINI DEBUG] Raw response (first 500 chars): {...}
[GEMINI DEBUG] Response is OK, parsing JSON
[GEMINI DEBUG] Parsed gemini response: {...}
↓
[Gemini] Received response from Gemini API
[Gemini] Found text part: Hello...
↓
[API DEBUG] About to return response to client
[API DEBUG] Response payload: {"content":[{"type":"text","text":"Hello..."}]}
[API DEBUG] Sending status 200
↓
[ATLAS DEBUG] Fetch completed, status: 200
[ATLAS DEBUG] Response is OK, parsing JSON
[ATLAS DEBUG] Response JSON parsed successfully
[ATLAS DEBUG] Response data: {"content":[{"type":"text"...
[ATLAS DEBUG] Found text content: true
[ATLAS DEBUG] Extracted text: Hello...
[ATLAS DEBUG] askClaude returning text, length: N
↓
[ATLAS MAIN] askClaude returned successfully
[ATLAS MAIN] Got response from Claude: Hello...
[ATLAS MAIN] Response type: string
[ATLAS MAIN] Response length: N
[ATLAS MAIN] Response is empty?: false
[ATLAS MAIN] Stop command flag not set, proceeding to speak
[ATLAS MAIN] Setting state to speaking
[ATLAS MAIN] About to call voiceInteraction.speak()
[ATLAS MAIN] Text to speak: Hello...
↓
[VoiceInput] Starting ElevenLabs TTS
[TTS] Requesting speech synthesis: Hello...
[TTS] Audio received, playing...
[TTS] Playing audio
[TTS] Audio finished
↓
[ATLAS MAIN] Speaking finished, transitioning back to listening
```

## Where Response Gets Lost (Check These Points)

### Point 1: Gemini API Response
**Look for:**
```
[GEMINI DEBUG] Gemini request completed, status: 200
```

**If this shows status 400, 401, 429, 500:**
- Gemini API failed
- Check API key
- Check request format

**If you DON'T see this log at all:**
- The fetch is hanging
- The Gemini API is not responding

### Point 2: JSON Parsing
**Look for:**
```
[GEMINI DEBUG] Response is OK, parsing JSON
[GEMINI DEBUG] Parsed gemini response: {
```

**If you DON'T see these logs:**
- Response body is empty
- Response is not valid JSON
- Status check failed

### Point 3: API Returns to Client
**Look for:**
```
[API DEBUG] About to return response to client
[API DEBUG] Response payload: {"content":[...]}
```

**If you DON'T see these:**
- Gemini response parsing failed
- No text content found in Gemini response
- Function returned early

### Point 4: Frontend Receives Response
**Look for:**
```
[ATLAS DEBUG] Fetch completed, status: 200
[ATLAS DEBUG] Response JSON parsed successfully
```

**If you see status 200 but no "parsed successfully":**
- Response JSON is malformed
- Response format unexpected

**If you don't see these at all:**
- /api/claude request failed
- Frontend never received response

### Point 5: Response Extraction
**Look for:**
```
[ATLAS DEBUG] Found text content: true
[ATLAS DEBUG] Extracted text: ...
```

**If you see "Found text content: false":**
- Response doesn't have the expected format
- content.find() returning null
- Gemini response format changed

### Point 6: Main Handler Receives Response
**Look for:**
```
[ATLAS MAIN] askClaude returned successfully
[ATLAS MAIN] Got response from Claude: ...
```

**If you DON'T see these:**
- askClaude() threw an exception
- Check console for `[ATLAS DEBUG] askClaude error:`

### Point 7: Early Exit Check
**Look for:**
```
[ATLAS MAIN] Stop command flag not set, proceeding to speak
```

**If instead you see:**
```
[ATLAS MAIN] EARLY RETURN: Stop command detected
```
- Stop flag was set
- Atlas is ignoring the response

### Point 8: Speak Called
**Look for:**
```
[ATLAS MAIN] About to call voiceInteraction.speak()
[ATLAS MAIN] Text to speak: ...
```

**If you DON'T see this:**
- Code is returning before reach this point
- Look for `[ATLAS MAIN] EARLY RETURN:` message

### Point 9: TTS Request
**Look for:**
```
[VoiceInput] Starting ElevenLabs TTS
[TTS] Requesting speech synthesis: ...
```

**If you DON'T see these:**
- voiceInteraction.speak() is not working
- TTS function not being called

---

## Troubleshooting Flowchart

```
Start: "Say hi"

Does Atlas respond with voice?
├─ YES → Problem is fixed! ✅
└─ NO
    └─ Check logs for missing sections:
        ├─ No [GEMINI DEBUG] logs?
        │  └─ Gemini API request failed
        ├─ No [API DEBUG] logs?
        │  └─ Gemini response not extracted
        ├─ No [ATLAS DEBUG] logs?
        │  └─ Frontend never called askClaude or request failed
        ├─ No [ATLAS MAIN] logs?
        │  └─ Response lost before reaching main handler
        ├─ See [ATLAS MAIN] EARLY RETURN?
        │  └─ Stop flag set unexpectedly
        └─ No [VoiceInput]/[TTS] logs?
           └─ voiceInteraction.speak() not called
```

---

## Copy-Paste These Search Terms

If logs are hard to find, use browser console find (Ctrl+F):

1. `[GEMINI DEBUG]` - Gemini API interaction
2. `[API DEBUG]` - API response preparation  
3. `[ATLAS DEBUG]` - Response parsing
4. `[ATLAS MAIN]` - Main component handler
5. `EARLY RETURN` - Exit before speaking

The FIRST missing log in the sequence tells you exactly where the problem is.

---

## Important Notes

- **Do NOT restart browser** between tests - logs accumulate in console
- **Clear console** before each test to avoid old logs
- **Copy all logs** if you want me to analyze them
- **Timestamp each test** if doing multiple tests
- **Look for errors** (red text) - they explain failures

---

## Next Steps After Logging

Once you identify where logs stop:

1. Note the LAST log you see
2. Note the FIRST log you DON'T see  
3. That's the exact function/line failing
4. Share those log excerpts with exact sequence

Example:
```
LAST log: [API DEBUG] Response payload: {...}
FIRST missing: [ATLAS DEBUG] Fetch completed
→ Problem: Response not reaching frontend ask Claude
```

Then I can fix the exact issue.

---

**Ready to debug. Start Atlas with `npm run dev`, open console (F12), and test "Hey Atlas" → "hi".**
