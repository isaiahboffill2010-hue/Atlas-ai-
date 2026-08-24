# OpenClaw Print Setup

This document covers the OpenClaw configuration required for Atlas to print files, particularly from the Downloads folder.

## Issue: "Outside allowed folders" Restriction

OpenClaw enforces folder access restrictions for security. When printing files, OpenClaw needs explicit permission to access the source folder.

## Configuration Required

### 1. **Downloads Folder Access**

For printing from `C:\Users\kingp\Downloads\`, you must configure OpenClaw's folder permissions:

**Location**: OpenClaw configuration (typically in `~/.openclaw/openclaw.json` or via OpenClaw CLI)

**Required scope/permission**: File system access to `C:\Users\kingp\Downloads\`

**Setup command** (if OpenClaw supports it):
```bash
openclaw config set allowed.folders += "C:\Users\kingp\Downloads"
```

OR in `openclaw.json`:
```json
{
  "security": {
    "allowedFolders": [
      "C:\\Users\\kingp\\Downloads",
      "C:\\Users\\kingp\\Desktop"
    ]
  }
}
```

### 2. **Printer Access**

OpenClaw's `print` or `system` tool needs permission to:
- Access the Windows print spooler
- Open the printer dialog
- Send files to the default printer

This is typically granted by default for system tools, but verify in OpenClaw's security settings if print operations fail.

### 3. **Narrow Security Principle**

✅ **DO**: Grant access ONLY to specific folders needed (Downloads, Desktop, Documents)
✅ **DO**: Use the minimal scope required for the operation
✅ **DO**: Review OpenClaw security documentation for the exact configuration syntax

❌ **DON'T**: Disable security globally or grant unrestricted filesystem access
❌ **DON'T**: Add system-wide wildcard paths (`*`, `C:\`)

## Atlas Configuration

Atlas is already configured to:
- ✅ Detect print requests
- ✅ Pass print operations to OpenClaw with priority instructions
- ✅ NOT read/view files unless explicitly asked
- ✅ Use Windows print dialog for image files
- ✅ Report success only after printing completes

## Print Workflow

When user says: `"Find Atlas test in Downloads and print it"`

1. **Atlas detects print request** → Sends to OpenClaw with print-priority instructions
2. **OpenClaw searches Downloads** → (requires folder access permission)
3. **File found**:
   - If 1 match → Proceed to print
   - If multiple matches → Ask user which file
4. **Print operation**:
   - Open File Explorer to file location
   - Invoke Windows print context menu
   - Select printer (default or user-specified)
   - Execute print
5. **Verification** → Report "Done — I printed ATLAS TEST.png"

## Troubleshooting

### Error: "Outside allowed folders"
- **Cause**: OpenClaw doesn't have permission to access the folder
- **Fix**: Add the folder to OpenClaw's allowed folders configuration
- **Verify**: Check OpenClaw's security settings with `openclaw config get`

### Error: "File not found"
- **Cause**: File doesn't exist at the specified path
- **Fix**: Verify the file exists and spell the filename correctly
- **Try**: Ask Atlas to list files in the folder first

### Print doesn't execute
- **Cause**: Printer access restricted or no default printer set
- **Fix**: Check Windows default printer settings
- **Verify**: Test printing directly from File Explorer first

## References

- OpenClaw security documentation: `https://docs.openclaw.ai/security`
- OpenClaw folder permissions: Check `openclaw config --help`
- Windows print settings: Windows Settings → Devices → Printers & scanners
