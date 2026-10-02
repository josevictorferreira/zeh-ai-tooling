# Before/After: Improving a Task

This example shows how to transform a poorly structured task into one that follows best practices.

## ❌ BEFORE: Poorly Structured Task

```yaml
task:
  id: t-003
  name: "Add authentication"

  estimate_minutes: 240  # TOO LARGE

  # NO STYLE ANGLES

  files:
    - src/auth/  # TOO VAGUE
    - src/middleware/  # COULD TOUCH MANY FILES
    - tests/  # UNCLEAR SCOPE

  instructions: |
    Add authentication to the application using JWT tokens.

    Don't use any new libraries unless absolutely necessary.
    Make sure it's secure and follows best practices.

    Write tests for everything.

    Don't break existing functionality.

    The user should be able to login and get a token.
    The token should be validated on protected routes.
    Invalid tokens should return 401.

    Make sure to handle all edge cases and errors properly.

    Add proper documentation.
```

### Problems with This Task

#### 1. **No Style Anchors** ❌
- No examples of existing patterns to follow
- Model will guess at conventions
- Likely to introduce inconsistent patterns

#### 2. **Too Large (240 minutes)** ❌
- Exceeds 150-minute maximum
- Touches unclear number of files
- Difficult to review in one go
- High risk of drift

#### 3. **Vague File Scope** ❌
- "src/auth/" could mean many files
- "tests/" is completely unclear
- No explicit limits on file count
- No drift prevention

#### 4. **Negative Framing** ❌
- "Don't use new libraries"
- "Don't break existing functionality"
- Negative constraints are harder to follow

#### 5. **No TDD Structure** ❌
- "Write tests for everything" is vague
- No test-first instruction
- No explicit test commands
- Could write tests after (or never)

#### 6. **No Validation Commands** ❌
- Unclear how to verify completion
- No lint/test/typecheck commands
- No expected outputs defined

#### 7. **No Drift Policy** ❌
- What if 10 files need touching?
- What if new library is genuinely needed?
- No stop criteria defined

#### 8. **Burying Requirements** ❌
- Critical security requirements mixed with suggestions
- No clear prioritization
- Easy to miss important constraints

#### 9. **No Commit Checkpoints** ❌
- 4-hour uncommitted work is hard to debug
- No clear milestones within the task

---

## ✅ AFTER: Well-Structured Task

### Split into 3 Tasks

#### Task 1: Authentication Types & Interfaces (60 minutes)

```yaml
task:
  id: t-auth-001
  name: "Define authentication types and interfaces"

  estimate_minutes: 60

  files:
    touch_only:
      - src/types/auth.ts
      - src/types/auth.test.ts
    modify_only: []

  style_anchors:
    - path: src/types/user.ts
      lines: 1-45
      description: "Type definition pattern with Zod schemas and tests"

    - path: src/types/api.ts
      lines: 12-34
      description: "Request/Response type pattern with validation"

  constraints:
    dependencies:
      only_use:
        - zod
      do_not_add: true

    file_scope:
      max_files: 2
      stop_if_exceeded: true

  instructions: |
    ## CRITICAL CONSTRAINTS
    - ONLY create the 2 files listed above
    - ONLY use: zod (already installed)
    - MUST pass: npm test, npm run lint, npm run typecheck

    ## Style Anchors
    See src/types/user.ts:1-45 for type + Zod schema pattern
    See src/types/api.ts:12-34 for request/response types

    ## TDD Checklist
    - [ ] Write tests for type validation
    - [ ] Implement Zod schemas
    - [ ] Add type exports
    - [ ] Verify all tests pass

    ## Implementation Steps
    1. Create src/types/auth.ts with:
       - LoginRequest schema + type
       - LoginResponse schema + type
       - AuthToken payload schema + type
       - JWTPayload type

    2. Create src/types/auth.test.ts with:
       - Test valid login request
       - Test invalid email format
       - Test missing fields
       - Test token payload validation

    ## Validation
    ```bash
    npm test src/types/auth.test.ts
    npm run typecheck
    npm run lint
    ```

    Expected: All tests passing, 0 errors

    ## HARD RULES
    - ONLY 2 files
    - Do not add dependencies
    - Tests must validate schemas thoroughly

  validation:
    commands:
      - npm test src/types/auth.test.ts
      - npm run typecheck
      - npm run lint
    expected_output: "All tests passing, 0 errors"
```

#### Task 2: JWT Token Service (90 minutes)

```yaml
task:
  id: t-auth-002
  name: "Implement JWT token generation and validation service"

  estimate_minutes: 90

  files:
    touch_only:
      - src/services/tokenService.ts
      - src/services/tokenService.test.ts
    modify_only: []

  style_anchors:
    - path: src/services/userService.ts
      lines: 15-78
      description: "Service pattern with error handling and dependency injection"

    - path: src/services/userService.test.ts
      lines: 20-67
      description: "Service test pattern with mocking"

    - path: src/types/result.ts
      lines: 1-30
      description: "Result<T> pattern for error handling"

  constraints:
    dependencies:
      only_use:
        - jsonwebtoken
        - zod
      do_not_add: true

    file_scope:
      max_files: 2
      stop_if_exceeded: true

    patterns:
      error_handling: "Use Result<T> from src/types/result.ts"
      testing: "Mock dependencies with jest.mock"

  instructions: |
    ## CRITICAL CONSTRAINTS
    - ONLY create the 2 files listed above
    - ONLY use: jsonwebtoken (already installed), zod
    - MUST pass: npm test, npm run lint, npm run typecheck

    ## Style Anchors
    See src/services/userService.ts:15-78 for service pattern
    See src/services/userService.test.ts:20-67 for test pattern
    See src/types/result.ts:1-30 for Result<T> pattern

    ## TDD Checklist
    - [ ] Write failing tests for token generation
    - [ ] Implement minimal tokenService
    - [ ] Add tests for validation
    - [ ] Add tests for expired tokens
    - [ ] Refactor while keeping tests green

    ## Implementation Steps
    1. Create src/services/tokenService.ts:
       - generateToken(payload: JWTPayload): Result<string>
       - validateToken(token: string): Result<JWTPayload>
       - Use jsonwebtoken library
       - Handle all error cases

    2. Create src/services/tokenService.test.ts:
       - Test successful token generation
       - Test token validation
       - Test expired token rejection
       - Test invalid token rejection
       - Test malformed token rejection

    ## Drift Policy
    STOP if:
    - Need to touch >2 files
    - Need new dependencies
    - Tests fail and tempted to modify tests

    ## Validation
    ```bash
    npm test src/services/tokenService.test.ts
    npm run typecheck
    npm run lint
    ```

    Expected: All tests passing, 0 errors

    ## HARD RULES
    - Do NOT modify tests to pass
    - Do NOT add dependencies
    - Use Result<T> for error handling
    - All error cases must be tested

  validation:
    commands:
      - npm test src/services/tokenService.test.ts
      - npm run typecheck
      - npm run lint
    expected_output: "All tests passing, 0 errors"
```

#### Task 3: Authentication Middleware & Login Endpoint (120 minutes)

```yaml
task:
  id: t-auth-003
  name: "Add authentication middleware and login endpoint"

  estimate_minutes: 120

  files:
    touch_only:
      - src/middleware/authMiddleware.ts
      - src/middleware/authMiddleware.test.ts
      - src/api/handlers/auth.ts
      - src/api/handlers/auth.test.ts
    modify_only:
      - src/api/routes.ts

  style_anchors:
    - path: src/middleware/validation.ts
      lines: 8-45
      description: "Middleware pattern with error handling"

    - path: src/middleware/validation.test.ts
      lines: 12-67
      description: "Middleware test pattern"

    - path: src/api/handlers/user.ts
      lines: 23-78
      description: "Handler pattern with validation and error handling"

    - path: src/api/handlers/user.test.ts
      lines: 15-52
      description: "Handler test pattern with supertest"

  constraints:
    dependencies:
      only_use:
        - express
        - express-validator
        - jsonwebtoken
        - zod
      do_not_add: true

    file_scope:
      max_files: 5
      stop_if_exceeded: true

    patterns:
      middleware: "Follow src/middleware/validation.ts pattern"
      handler: "Follow src/api/handlers/user.ts pattern"
      error_handling: "Use Result<T> pattern"

  instructions: |
    ## CRITICAL CONSTRAINTS
    - ONLY modify the 5 files listed above
    - ONLY use: express, express-validator, jsonwebtoken, zod
    - MUST pass: npm test, npm run lint, npm run typecheck

    ## Style Anchors
    See src/middleware/validation.ts:8-45 for middleware pattern
    See src/api/handlers/user.ts:23-78 for handler pattern
    Use services from t-auth-001 and t-auth-002

    ## TDD Checklist
    - [ ] Write failing test for POST /auth/login
    - [ ] Implement login handler
    - [ ] Write failing test for auth middleware
    - [ ] Implement auth middleware
    - [ ] Add tests for error cases
    - [ ] Refactor while keeping tests green

    ## Implementation Steps
    1. Create src/api/handlers/auth.ts:
       - login handler (POST /auth/login)
       - Validate credentials
       - Generate token using tokenService
       - Return LoginResponse

    2. Create src/api/handlers/auth.test.ts:
       - Test successful login
       - Test invalid credentials
       - Test missing fields
       - Test validation errors

    3. Create src/middleware/authMiddleware.ts:
       - Extract token from Authorization header
       - Validate token using tokenService
       - Attach user to request
       - Return 401 for invalid tokens

    4. Create src/middleware/authMiddleware.test.ts:
       - Test valid token
       - Test missing token
       - Test invalid token
       - Test expired token

    5. Modify src/api/routes.ts:
       - Add POST /auth/login route
       - Apply authMiddleware to protected routes

    ## Drift Policy
    STOP if:
    - Need to touch >5 files
    - Need new dependencies
    - Tests fail and tempted to modify tests

    ## Validation
    ```bash
    npm test src/api/handlers/auth.test.ts
    npm test src/middleware/authMiddleware.test.ts
    npm test
    npm run typecheck
    npm run lint
    ```

    Expected: All tests passing, 0 errors

    ## HARD RULES
    - Do NOT modify tests to pass
    - Do NOT add dependencies
    - Use existing services (types, tokenService)
    - Follow middleware and handler patterns exactly

  validation:
    commands:
      - npm test src/api/handlers/auth.test.ts
      - npm test src/middleware/authMiddleware.test.ts
      - npm test
      - npm run typecheck
      - npm run lint
    expected_output: "All tests passing, 0 errors"
```

### Improvements Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Task Size** | 240 min (too large) | 60 + 90 + 120 = 270 min (properly split) |
| **Style Anchors** | 0 | 2-3 per task |
| **File Scope** | Vague ("src/auth/") | Explicit (2-5 files per task) |
| **Instructions** | Negative ("Don't use") | Affirmative ("ONLY use") |
| **TDD** | Vague ("write tests") | Explicit checklist + test commands |
| **Validation** | None | Explicit commands + expected outputs |
| **Drift Policy** | None | Clear stop criteria + revert process |
| **Commit Checkpoints** | None | After each task (3 commits) |

### Benefits of the Split

1. **Easier to Review:** Each task is 60-120 minutes, easy to understand
2. **Lower Risk:** If task 2 drifts, only 90 minutes of work affected
3. **Clearer Scope:** Exact files listed, no ambiguity
4. **Better Quality:** TDD enforced at each step
5. **Easier Debugging:** Problems caught early in 60-min task, not at end of 240-min task
6. **Parallelization:** Task 1 can be reviewed while task 2 is being implemented
7. **Incremental Value:** Types can be used even if implementation isn't complete

### Key Takeaway

**The 240-minute "add authentication" task was a recipe for drift:**
- No guidance → model guesses patterns
- Large scope → difficult to review
- Vague boundaries → easy to exceed file limits
- No checkpoints → errors compound

**The split tasks are drift-resistant:**
- Clear patterns → model follows existing code
- Small scope → easy to review and revert
- Explicit boundaries → drift detected immediately
- Multiple checkpoints → errors caught early
