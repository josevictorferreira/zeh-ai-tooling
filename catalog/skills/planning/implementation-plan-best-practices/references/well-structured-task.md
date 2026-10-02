# Example: Well-Structured Task

This example demonstrates all best practices applied to a single task.

## Task Definition

```yaml
task:
  id: t-user-api-002
  name: "Add user profile update endpoint"

  estimate_minutes: 90

  files:
    touch_only:
      - src/api/handlers/profile.ts
      - src/api/handlers/profile.test.ts
    modify_only:
      - src/api/routes.ts
      - src/types/api.ts

  style_anchors:
    - path: src/api/handlers/user.ts
      lines: 23-67
      description: "Handler pattern with validation, error handling, and response formatting"

    - path: src/api/handlers/user.test.ts
      lines: 15-52
      description: "Test structure: describe blocks, beforeEach setup, clear assertions"

    - path: src/middleware/validation.ts
      lines: 8-34
      description: "Input validation middleware pattern with express-validator"

  constraints:
    dependencies:
      only_use:
        - express
        - express-validator
        - zod
      do_not_add: true

    file_scope:
      max_files: 4
      stop_if_exceeded: true

    patterns:
      error_handling: "Use Result<T> pattern from src/types/result.ts"
      validation: "Use express-validator middleware chain"
      response: "Use ApiResponse<T> from src/types/api.ts"

  instructions: |
    ## CRITICAL CONSTRAINTS
    - ONLY modify the 4 files listed above
    - ONLY use dependencies: express, express-validator, zod
    - MUST pass: npm test, npm run lint, npm run typecheck

    ## Style Anchors (FOLLOW THESE PATTERNS)

    ### Handler Pattern
    See `src/api/handlers/user.ts:23-67`
    - Use async/await for all handlers
    - Wrap in try/catch with proper error types
    - Validate input before processing
    - Return ApiResponse<T> format

    ### Test Pattern
    See `src/api/handlers/user.test.ts:15-52`
    - Use describe/it blocks for organization
    - beforeEach for setup
    - Test success case + 2-3 error cases
    - Use supertest for HTTP assertions

    ### Validation Pattern
    See `src/middleware/validation.ts:8-34`
    - Use express-validator chain
    - Custom validators in separate file
    - Return 400 with specific error messages

    ## TDD Checklist
    - [ ] Write failing test for PUT /api/profile
    - [ ] Implement minimal handler to pass
    - [ ] Add tests for:
      - [ ] Invalid email format
      - [ ] Missing required fields
      - [ ] Unauthorized access
    - [ ] Refactor for clarity while keeping tests green

    ## Implementation Steps

    1. **Create test file** (src/api/handlers/profile.test.ts)
       - Write test for successful profile update
       - Test should fail (handler doesn't exist)

    2. **Add type definitions** (src/types/api.ts)
       - Add UpdateProfileRequest interface
       - Add UpdateProfileResponse interface

    3. **Implement handler** (src/api/handlers/profile.ts)
       - Create updateProfile function
       - Add input validation
       - Implement business logic
       - Return proper response format

    4. **Register route** (src/api/routes.ts)
       - Add PUT /api/profile route
       - Apply authentication middleware
       - Apply validation middleware

    5. **Add error case tests**
       - Invalid email format
       - Missing required fields
       - Unauthorized user

    ## Drift Policy

    **STOP IMMEDIATELY if:**
    - You need to touch >4 files
    - You need to add new dependencies
    - Tests fail and you're tempted to modify tests
    - Linting errors cannot be fixed within task scope

    **If drift detected:**
    1. Stop current work
    2. Run `git diff` to review changes
    3. Revert with `git checkout .`
    4. Document in `docs/drift-incidents/YYYY-MM-DD-profile-task.md`

    **Allowed deviations:**
    - Minor formatting (prettier auto-fixes)
    - Adding missing type imports in existing files

    ## Validation Commands

    Run after each step:

    ```bash
    # Type checking
    npm run typecheck

    # Linting (must have 0 errors)
    npm run lint

    # Run specific test file
    npm test src/api/handlers/profile.test.ts

    # Run all tests
    npm test
    ```

    Expected output:
    - 0 TypeScript errors
    - 0 lint errors
    - All tests passing
    - Coverage >80% for new files

    If validation fails:
    - STOP
    - Fix the issue
    - Do not continue to next step

    ## HARD RULES (REITERATED)

    1. **Do NOT modify tests to make them pass**
       - Tests define expected behavior
       - Fix implementation, not tests

    2. **Do NOT add new dependencies**
       - Only use: express, express-validator, zod
       - If you need something else, STOP and ask

    3. **Do NOT exceed file scope**
       - Max 4 files
       - If you need more, STOP and discuss

    4. **Commit after each major step**
       - After tests written
       - After implementation complete
       - After refactoring

    5. **Run validation after every change**
       - Don't accumulate errors
       - Fix issues immediately

  validation:
    commands:
      - npm run typecheck
      - npm run lint
      - npm test src/api/handlers/profile.test.ts
      - npm test
    expected_output: |
      ✖ typecheck: 0 errors
      ✖ lint: 0 errors, 0 warnings
      ✓ profile.test.ts: 5 tests passed
      ✓ all tests: 47 tests passed
    failure_handling: |
      STOP immediately.
      Fix the specific issue.
      Do not proceed to next step.
      If cannot fix within 15 minutes, escalate.
```

## Why This Task Is Well-Structured

### ✅ Style Anchors (3 provided)
- Concrete file paths with line numbers
- Clear descriptions of what pattern to follow
- Covers handler + test + validation patterns

### ✅ Task Sizing (90 minutes)
- Within optimal 30-150 minute range
- Limited to 4 files
- Clear deliverable (endpoint with tests)

### ✅ TDD Requirements
- Explicit checklist included
- Test-first approach enforced
- "Revise implementation, not tests" clearly stated

### ✅ Affirmative Instructions
- "ONLY use" instead of "don't use"
- "ONLY modify" with explicit file list
- Clear dependency boundaries

### ✅ Drift Prevention
- Stop criteria clearly defined
- Revert instructions included
- Allowed deviations listed
- Incident documentation process specified

### ✅ Quality Gates
- Explicit validation commands
- Expected outputs documented
- Failure handling defined

### ✅ Prompt Positioning
- Critical constraints at beginning
- Hard rules reiterated at end
- Clear structure (Constraints → Anchors → Steps → Validation → Rules)

### ✅ Layered Verification
- Prompt level: Explicit constraints and anchors
- IDE level: Typecheck and lint commands
- Commit level: "Commit after each major step"
- Test level: TDD checklist and test commands

## What This Prevents

By following this structure, you prevent:

1. **Architectural drift:** Style anchors ensure consistent patterns
2. **Scope creep:** File limits and task sizing prevent overreach
3. **Test weakening:** "Don't modify tests" rule enforced
4. **Dependency bloat:** Explicit "ONLY use" list
5. **Accumulated errors:** Validation after each step
6. **Large, unreviewable changes:** 90-minute chunks are easy to review
7. **Unclear completion criteria:** Expected outputs defined
8. **Mid-stream fixes:** Drift policy stops problems early
