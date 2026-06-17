# Claudoro: Specification

## Overview
<!-- One paragraph: what this is and how it works at a high level -->

## Architecture
<!-- System components, how they connect, why this structure.
     Reference key decisions from decisions.md -->

## Data Model
<!-- Entities, relationships, constraints, indices.
     For each entity: fields (with types and constraints), relationships (with cardinality), lifecycle (create/update/delete) -->

## Modules

<!-- Copy this block for each module: -->

### [Module Name]
**Does:** <!-- one sentence -->

**Inputs:**
- <!-- what it receives, from where, in what format -->

**Outputs:**
- <!-- what it produces, to where, in what format -->

**Behaviour:**
1. <!-- step, what happens (include what happens when it fails) -->
2. <!-- step -->

**Edge Cases:**
- <!-- what if input is empty/malformed/huge? -->
- <!-- what if a dependency is unavailable? -->
- <!-- what if there's concurrent access? -->

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| <!-- error case --> | <!-- what happens --> | <!-- how to recover --> |

## API / Interfaces
<!-- Every boundary where components talk to each other or the outside world.
     For each endpoint: method, path, auth, request shape, response shape(s), errors, pagination, rate limits -->

## Non-Functional Requirements
<!-- Performance targets, security requirements, deployment approach,
     monitoring, logging, but ONLY what the build team needs to know -->

## Build Sequence
<!-- What order to build things in. What can be parallelised.
     Integration checkpoints. -->
1. 
2. 

## Acceptance Criteria
<!-- Per-feature: Given/When/Then format. Must be testable, not subjective.
     Trace each criterion back to a charter success criterion. -->

## Test Specifications

### Coverage Matrix
<!-- Generated during assembly, maps charter success criteria to test IDs -->
| Charter Success Criterion | Test IDs | Coverage |
|---|---|---|
| <!-- criterion --> | <!-- TEST-XXX-NNN --> | <!-- ✓ Full / ○ Partial / ✗ None --> |

<!-- Test specs are generated progressively:
     - Baseline: one per behaviour path + one per error condition when a module is specified
     - Simulation-derived: added as walkthroughs, contract tests, and consequence analyses discover edge cases
     - Format per test spec:

### TEST-[MODULE]-[NNN]: [Title]
**Source:** [spec section this verifies]
**Type:** [unit | API contract | integration | performance | manual review]
**Preconditions:**
- [what must be true before the test]
**Steps:**
1. [action]
**Expected:**
- [precise, verifiable outcome]
**Derived from:** [baseline | simulation ID]
-->

## Glossary
<!-- Domain terms that might be ambiguous. Define them precisely. -->
| Term | Definition |
|---|---|
