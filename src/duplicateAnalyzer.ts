import { Node, SyntaxKind } from 'ts-morph';
import { SymbolCandidateWithNode } from './staticAnalyzer';

export interface CandidateWithFile {
  filePath: string;
  candidate: SymbolCandidateWithNode;
}

export interface SimilarityResult {
  similarToName: string;
  similarToFile: string;
}

interface AnalyzedCandidate {
  original: CandidateWithFile;
  normalizedBody: string;
  paramCount: number;
  controlFlowCount: number;
  statementCount: number;
}

export class DuplicateAnalyzer {
  private cachedResults: Map<string, SimilarityResult[]> | undefined;

  public invalidateCache(): void {
    this.cachedResults = undefined;
  }

  public hasCachedResults(): boolean {
    return this.cachedResults !== undefined;
  }

  public getSimilarFunctions(key: string): SimilarityResult[] | undefined {
    return this.cachedResults?.get(key);
  }

  public findSimilarFunctions(
    candidates: CandidateWithFile[],
    tolerance: number
  ): Map<string, SimilarityResult[]> {
    if (this.cachedResults) return this.cachedResults;

    const analyzed = candidates.map(c => this.analyzeCandidate(c));
    const results = new Map<string, SimilarityResult[]>();

    for (let i = 0; i < analyzed.length; i++) {
      const a = analyzed[i];
      if (a.statementCount < 3) continue;

      const similarTo = [];
      for (let j = 0; j < analyzed.length; j++) {
        if (i === j) continue;
        const b = analyzed[j];
        if (b.statementCount < 3) continue;

        if (this.areSimilar(a, b, tolerance)) {
          similarTo.push({
            similarToName: b.original.candidate.name,
            similarToFile: b.original.filePath
          });
        }
      }

      if (similarTo.length > 0) {
        results.set(`${a.original.filePath}::${a.original.candidate.name}`, similarTo);
      }
    }

    this.cachedResults = results;
    return results;
  }

  private areSimilar(a: AnalyzedCandidate, b: AnalyzedCandidate, tolerance: number): boolean {
    if (a.normalizedBody === b.normalizedBody) return true;

    if (a.paramCount === b.paramCount && a.controlFlowCount === b.controlFlowCount) {
      const lengthA = a.normalizedBody.length;
      const lengthB = b.normalizedBody.length;
      if (lengthA === 0 || lengthB === 0) return false;

      const ratio = lengthA > lengthB ? lengthA / lengthB : lengthB / lengthA;
      // ratio is e.g. 1.15.  1 + tolerance is 1.15 if tolerance is 0.15.
      if (ratio <= 1.0 + tolerance) {
        return true;
      }
    }

    return false;
  }

  private analyzeCandidate(input: CandidateWithFile): AnalyzedCandidate {
    const node = input.candidate.node;
    const paramCount = node.getParameters().length;
    
    let statementCount = 0;
    const body = node.getBody();
    if (body) {
      if (Node.isBlock(body)) {
        statementCount = body.getStatements().length;
      } else {
        statementCount = 1;
      }
    }

    const { normalizedText, controlFlowCount } = this.normalizeBody(node);

    return {
      original: input,
      normalizedBody: normalizedText,
      paramCount,
      controlFlowCount,
      statementCount
    };
  }

  private normalizeBody(node: Node): { normalizedText: string; controlFlowCount: number } {
    let controlFlowCount = 0;
    
    const body = (node as any).getBody?.();
    if (!body) return { normalizedText: '', controlFlowCount: 0 };

    const replacements: { start: number; end: number; text: string }[] = [];

    body.forEachDescendant((n: Node) => {
      const kind = n.getKind();
      if (
        kind === SyntaxKind.IfStatement ||
        kind === SyntaxKind.ForStatement ||
        kind === SyntaxKind.ForInStatement ||
        kind === SyntaxKind.ForOfStatement ||
        kind === SyntaxKind.WhileStatement ||
        kind === SyntaxKind.DoStatement ||
        kind === SyntaxKind.SwitchStatement ||
        kind === SyntaxKind.ReturnStatement
      ) {
        controlFlowCount++;
      }

      if (Node.isIdentifier(n)) {
        const parent = n.getParent();
        if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === n) {
          return;
        }
        if (parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === n) {
          return;
        }
        
        replacements.push({
          start: n.getStart() - body.getStart(),
          end: n.getEnd() - body.getStart(),
          text: '$ID$'
        });
      }
    });

    replacements.sort((a, b) => b.start - a.start);
    
    let text = body.getText();
    for (const r of replacements) {
      if (r.start >= 0 && r.end <= text.length) {
        text = text.substring(0, r.start) + r.text + text.substring(r.end);
      }
    }

    const normalizedText = text.replace(/\s+/g, '');

    return { normalizedText, controlFlowCount };
  }
}
