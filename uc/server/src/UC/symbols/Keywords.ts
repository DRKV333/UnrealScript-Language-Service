import { CompletionItem, CompletionItemKind, SymbolKind } from 'vscode-languageserver-types';

import { UCDocument } from '../DocumentListener';
import { ISymbol } from './ISymbol';
import { SymbolVisitor } from '../SymbolVisitor';

export class UCKeyword implements ISymbol, CompletionItem {
	kind: CompletionItemKind = CompletionItemKind.Keyword;

	constructor(public label: string) {}

	getName() {
		return this.label;
	}

	getKind(): SymbolKind {
		return this.kind;
	}

	getQualifiedName(): string {
		throw new Error('Method not implemented.');
	}

	getTooltip(): string {
		throw new Error('Method not implemented.');
	}

	toCompletionItem(_document: UCDocument): CompletionItem {
		return this;
	}

	accept<Result>(visitor: SymbolVisitor<Result>): Result {
		return visitor.visit(this);
	}
}

export const ReliableKeyword = new UCKeyword('reliable');
export const UnreliableKeyword = new UCKeyword('unreliable');