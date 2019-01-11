import { Range, SymbolKind, SymbolInformation, CompletionItem, CompletionItemKind, Location, Position } from 'vscode-languageserver-types';
import { Token } from 'antlr4ts';
import { ISimpleSymbol } from './ISimpleSymbol';
import { ISymbolId } from './symbols';
import { UCDocument } from "../UCDocument";

/**
 * A symbol that resides in a document, holding an id and range.
 */
export abstract class UCSymbol implements ISimpleSymbol {
	public outer?: ISimpleSymbol;

	/** Locations that reference this symbol. */
	private links?: Location[];

	private commentToken?: Token;

	constructor(private id: ISymbolId) {
	}

	getTooltip(): string | undefined {
		return this.getName();
	}

	getDocumentation(): string | undefined {
		return this.commentToken ? this.commentToken.text : undefined;
	}

	// tryAddComment() {
	// 	const tokens = stream.getHiddenTokensToLeft(this.offset, UCGrammarLexer.HIDDEN);
	// 	if (tokens) {
	// 		const lastToken = tokens.pop();
	// 		if (lastToken) {
	// 			this.commentToken = lastToken;
	// 		}
	// 	}
	// }

	getName(): string {
		return this.id.name;
	}

	getQualifiedName(): string {
		if (this.outer) {
			return this.outer.getQualifiedName() + '.' + this.getName();
		}
		return this.getName();
	}

	getKind(): SymbolKind {
		return SymbolKind.Field;
	}

	getCompletionItemKind(): CompletionItemKind {
		return CompletionItemKind.Text;
	}

	getRange(): Range {
		return this.getIdRange();
	}

	getIdRange(): Range {
		return this.id.range;
	}

	protected isIdWithinPosition(position: Position): boolean {
		var range = this.id.range;
		var isInRange = position.line >= range.start.line && position.line <= range.end.line
			&& position.character >= range.start.character && position.character <= range.end.character;
		return isInRange;
	}

	getSymbolAtPos(position: Position): UCSymbol | undefined {
		if (this.isIdWithinPosition(position)) {
			return this;
		}
		return undefined;
	}

	link(_document: UCDocument) {
	}

	addReference(location: Location) {
		if (!this.links) {
			this.links = [];
		}
		this.links.push(location);
	}

	getReferences(): Location[] | undefined {
		return this.links;
	}

	getUri(): string {
		return this.outer.getUri();
	}

	toSymbolInfo(): SymbolInformation {
		return SymbolInformation.create(this.getName(), this.getKind(), this.getRange(), undefined, this.outer.getName());
	}

	toCompletionItem(): CompletionItem {
		const item = CompletionItem.create(this.getName());
		item.detail = this.getTooltip();
		item.documentation = this.getDocumentation();
		item.kind = this.getCompletionItemKind();
		return item;
	}
}
