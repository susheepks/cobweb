import { expect } from 'chai';

/**
 * Phase 4: "Copy AI cleanup prompt" tests.
 *
 * The prompt-building logic lives in extension.ts (inside a command handler),
 * so we extract it here as a pure function to unit-test the template without
 * needing the VS Code host.  The real command calls this same logic then
 * hands the string to vscode.env.clipboard.writeText().
 */

interface PromptInputs {
  symbolName: string;
  relPath: string;
  referenceCountInProject: number;
  isExported: boolean;
  lastModifiedISO: string | null;
  daysSinceLastModified: number | null;
  lastAuthor: string | null;
  repoUsable: boolean;
  snippetLines?: string[];
}

/** Mirrors the prompt-building logic in extension.ts cobweb.copyCleanupPrompt */
function buildCleanupPrompt(inputs: PromptInputs): string {
  const {
    symbolName, relPath, referenceCountInProject, isExported,
    lastModifiedISO, daysSinceLastModified, lastAuthor, repoUsable,
    snippetLines,
  } = inputs;

  const refCount = referenceCountInProject;
  const isExportedStr = isExported ? 'yes' : 'no';
  const gitLine = lastModifiedISO
    ? `Last touched ${daysSinceLastModified} day(s) ago by ${lastAuthor ?? 'unknown'} (${new Date(lastModifiedISO).toLocaleDateString()})`
    : repoUsable
    ? 'No git history found for this function'
    : 'Git history unavailable';

  let snippetBlock = '';
  if (snippetLines && snippetLines.length > 0) {
    snippetBlock = `\n\nFunction source (first ~50 lines):\n\`\`\`\n${snippetLines.join('\n')}\n\`\`\``;
  }

  return [
    `# Cobweb Dead-Code Review: \`${symbolName}\``,
    '',
    `I'm reviewing a function flagged by the Cobweb VS Code extension as possibly dead code.`,
    `Please help me decide what to do with it.`,
    '',
    '## Function Details',
    `- **Name:** \`${symbolName}\``,
    `- **File:** \`${relPath}\``,
    `- **Internal callers found:** ${refCount === -1 ? 'unknown (analysis failed)' : refCount}`,
    `- **Exported:** ${isExportedStr}`,
    `- **Git history:** ${gitLine}`,
    '',
    '## Questions for you',
    '1. Based on the source, can you tell if this function is genuinely dead, or might it be called dynamically (e.g. via string dispatch, framework convention, or reflection)?',
    '2. If it IS dead, suggest a one-line summary of what it did so I can write a useful commit message when I delete it.',
    '3. If it is NOT dead, explain why and what I should do instead (add a call-site reference, add a test, etc.).',
    '4. If it is similar to other functions in the codebase, suggest how it could be refactored into a shared utility.',
    snippetBlock,
  ].join('\n');
}

describe('AI cleanup prompt builder (Phase 4)', () => {
  it('includes the function name as a heading and in the details', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'legacyFormatDate',
      relPath: 'src/utils/date.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: '2023-01-15T10:00:00Z',
      daysSinceLastModified: 560,
      lastAuthor: 'alice',
      repoUsable: true,
    });

    expect(prompt).to.include('# Cobweb Dead-Code Review: `legacyFormatDate`');
    expect(prompt).to.include('**Name:** `legacyFormatDate`');
  });

  it('includes the relative file path', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'oldHelper',
      relPath: 'src/helpers/old.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: true,
    });

    expect(prompt).to.include('**File:** `src/helpers/old.ts`');
  });

  it('shows reference count of 0 correctly', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(prompt).to.include('**Internal callers found:** 0');
  });

  it('shows "unknown" for reference count -1', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: -1,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(prompt).to.include('**Internal callers found:** unknown (analysis failed)');
  });

  it('shows exported status correctly', () => {
    const exportedPrompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: true,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(exportedPrompt).to.include('**Exported:** yes');

    const internalPrompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(internalPrompt).to.include('**Exported:** no');
  });

  it('formats git history line when history is available', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: '2024-03-10T00:00:00Z',
      daysSinceLastModified: 120,
      lastAuthor: 'bob',
      repoUsable: true,
    });
    expect(prompt).to.include('Last touched 120 day(s) ago by bob');
  });

  it('shows "No git history found" when repo is usable but no history exists', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: true,
    });
    expect(prompt).to.include('No git history found for this function');
  });

  it('shows "Git history unavailable" when repo is not usable', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(prompt).to.include('Git history unavailable');
  });

  it('includes a source snippet block when lines are provided', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
      snippetLines: ['function fn() {', '  return 42;', '}'],
    });
    expect(prompt).to.include('```');
    expect(prompt).to.include('function fn() {');
    expect(prompt).to.include('return 42;');
  });

  it('omits snippet block when no lines are provided', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    // No snippet lines → no code block
    expect(prompt).not.to.include('```');
  });

  it('always includes all four review questions', () => {
    const prompt = buildCleanupPrompt({
      symbolName: 'fn',
      relPath: 'a.ts',
      referenceCountInProject: 0,
      isExported: false,
      lastModifiedISO: null,
      daysSinceLastModified: null,
      lastAuthor: null,
      repoUsable: false,
    });
    expect(prompt).to.include('1.');
    expect(prompt).to.include('2.');
    expect(prompt).to.include('3.');
    expect(prompt).to.include('4.');
  });
});
