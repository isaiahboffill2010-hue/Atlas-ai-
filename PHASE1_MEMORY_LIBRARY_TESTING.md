# Phase 1: Memory Library Testing Guide

This document outlines the critical tests for Phase 1 of the Memory Library transformation.

## Environment Setup

Before testing, ensure `.env.local` has:
```
REPRESENTED_PERSON_NAME=Test Person
```

## Test Cases

### 1. Upload Tests

#### 1.1 PDF Upload with New Categories
- [ ] Navigate to Memory Library
- [ ] Click "+ Add Memory"
- [ ] Test each new category:
  - [ ] Life Story
  - [ ] Childhood
  - [ ] Family & Relationships
  - [ ] Important Memories
  - [ ] Personality & Traits
  - [ ] Work & Career
  - [ ] Likes & Dislikes
  - [ ] Life Lessons
  - [ ] Personal Stories
  - [ ] Other
- [ ] For each category, verify document types are available
- [ ] Upload a test PDF to each category
- [ ] Verify files appear in "All Memories" list

#### 1.2 Text File Upload
- [ ] Create a .txt file with personal information
- [ ] Upload as a memory
- [ ] Verify file appears in Memory Library

#### 1.3 Markdown Upload
- [ ] Create a .md file with formatted personal notes
- [ ] Upload as a memory
- [ ] Verify file appears and can be processed

#### 1.4 DOCX Upload
- [ ] Create or use a .docx file
- [ ] Upload as a memory
- [ ] Verify file appears

### 2. Category Tests

#### 2.1 Verify New Categories Display
- [ ] Check LibraryDashboard shows all 10 new categories
- [ ] Verify each category has correct icon and description
- [ ] Verify category counts update as files are added

#### 2.2 Category Isolation
- [ ] Upload a file to "Life Story"
- [ ] Upload a file to "Family & Relationships"
- [ ] Verify files appear in correct categories
- [ ] Verify counts are accurate

### 3. Existing Business Files Tests

#### 3.1 Backward Compatibility
- [ ] Check if any old business files exist in database
- [ ] If they exist, verify they still appear in system
- [ ] Verify old categories (Business, Printing, Education, Personal) are not shown in UI for new uploads
- [ ] Confirm old files are not silently reclassified

### 4. PDF Text Extraction

#### 4.1 Extract and Process
- [ ] Upload a PDF with personal information (e.g., biography, timeline)
- [ ] Wait for processing status to show "ready"
- [ ] Verify extracted text is stored
- [ ] Confirm processing was successful

#### 4.2 Search and Retrieve
- [ ] In the file details modal, verify content shows
- [ ] Search for a keyword from the uploaded PDF
- [ ] Verify the file appears in search results

### 5. Knowledge Retrieval Tests

#### 5.1 Relevant Information Retrieved
- [ ] Upload PDF with: "John graduated from MIT in 2015"
- [ ] Use `/api/knowledge/search` endpoint with query: "education"
- [ ] Verify returned context includes the graduate information
- [ ] Verify context is formatted as "PERSONAL MEMORY CONTEXT"
- [ ] Verify source metadata is included

#### 5.2 No Retrieval for Missing Info
- [ ] Upload PDF with: "Likes pizza and hiking"
- [ ] Query: "favorite sports"
- [ ] Verify no results returned (pizza/hiking are not sports)
- [ ] Verify system doesn't invent information

### 6. Claude Integration Tests

#### 6.1 Grounding in Documented Facts
- [ ] Upload PDF: "Born in Boston, Massachusetts"
- [ ] Ask Claude: "Where were you born?"
- [ ] Verify Claude answers: "Boston" (grounded in Memory Library)
- [ ] Verify Claude doesn't invent birth details

#### 6.2 Expressing Uncertainty
- [ ] Ensure Memory Library has NO information about career
- [ ] Ask Claude: "What was your first job?"
- [ ] Verify Claude expresses uncertainty: "I don't have that documented..."
- [ ] Verify Claude DOES NOT invent a job

#### 6.3 Partial Information Handling
- [ ] Upload PDF: "Worked at TechCorp from 2015-2018 as a developer"
- [ ] Ask Claude: "Tell me about your career"
- [ ] Verify Claude uses documented information
- [ ] Ask: "What did you do after TechCorp?"
- [ ] Verify Claude says it's not documented (doesn't invent)

#### 6.4 Using Person's Name
- [ ] Set `REPRESENTED_PERSON_NAME=Jane Doe`
- [ ] Ask Claude: "Who are you?"
- [ ] Verify Claude identifies as "AI representation of Jane Doe" (not as "Atlas")

#### 6.5 Personality Consistency
- [ ] Upload PDF: "I love history and read classics often"
- [ ] Ask Claude: "What are your interests?"
- [ ] Verify Claude references reading/history
- [ ] Upload PDF: "I'm very punctual and organized"
- [ ] Ask Claude: "Tell me about yourself"
- [ ] Verify Claude reflects these traits naturally

### 7. Unrelated Document Tests

#### 7.1 Don't Create False Connections
- [ ] Upload PDF A: "Played tennis in college"
- [ ] Upload PDF B: "Studied chemistry"
- [ ] Ask Claude: "Did you play tennis?"
- [ ] Verify Claude answers based on PDF A, doesn't connect to chemistry
- [ ] Ask: "What did you study?"
- [ ] Verify Claude answers based on PDF B

#### 7.2 No Invention from Fragments
- [ ] Upload PDF with only: "visited Paris"
- [ ] Ask Claude: "Tell me about your travels"
- [ ] Verify Claude mentions Paris (documented)
- [ ] Ask: "Where else have you traveled?"
- [ ] Verify Claude doesn't invent other destinations

### 8. Security Tests

#### 8.1 File Access Control
- [ ] Verify only files uploaded through the UI are accessible
- [ ] Attempt direct file path access (should fail gracefully)
- [ ] Verify file IDs are non-sequential and secure

#### 8.2 Memory Isolation
- [ ] Verify API endpoints validate file ownership
- [ ] Attempt to access memory file with manipulated ID
- [ ] Verify system rejects invalid IDs

### 9. UI/UX Tests

#### 9.1 Terminology Consistency
- [ ] Verify page title is "Memory Library"
- [ ] Verify button text is "+ Add Memory"
- [ ] Verify sidebar shows "Memory Library"
- [ ] Verify headings say "Memory Categories" not "Knowledge Categories"
- [ ] Verify search placeholder says "Search memories..."
- [ ] Verify empty state message mentions "Memory Library"

#### 9.2 File Management
- [ ] Delete a memory file
- [ ] Verify confirmation dialog mentions "Memory Library"
- [ ] Verify file is removed from list

### 10. Database Integrity Tests

#### 10.1 New Fields Are Optional
- [ ] Upload a memory file
- [ ] Check database: `Atlas/database/files.json`
- [ ] Verify `data_type` field is not present (Phase 2 feature)
- [ ] Verify file record is valid without `data_type`

#### 10.2 Schema Compatibility
- [ ] Verify new records have all existing fields:
  - [ ] `id`
  - [ ] `name`
  - [ ] `path`
  - [ ] `category` (new values: LifeStory, Childhood, etc.)
  - [ ] `type`
  - [ ] `size`
  - [ ] `created_at`
  - [ ] `updated_at`
  - [ ] `processing_status`
  - [ ] `extracted_text` (after processing)

## Test Results Template

For each test section, record:
```
[TEST NAME]
Status: PASS / FAIL
Notes: 
- Any issues encountered
- Screenshots if relevant
- Unexpected behaviors
```

## Known Limitations (Phase 1)

These are expected and will be addressed in future phases:
- No voice input from memories
- No automatic memory extraction from conversations
- No relationship linking between memories
- No embeddings-based retrieval (keyword only)
- No personality modeling
- No autonomous outreach

## Sign-Off

- [ ] All critical tests passed
- [ ] No blocking issues found
- [ ] UI terminology is consistent
- [ ] Claude behaves as AI companion, not business owner
- [ ] No invented memories detected
- [ ] Database schema is backward compatible
- [ ] Ready for Phase 2 planning
