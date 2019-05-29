import { CompletionItemKind, Position, SymbolKind } from 'vscode-languageserver-types';

import { intersectsWith } from '../helpers';
import { UCDocument } from '../document';
import { SymbolWalker } from '../symbolWalker';
import { UCBlock } from '../statements';

import { ISymbol, UCFieldSymbol, UCPropertySymbol, UCSymbol, UCTypeSymbol, UCMethodSymbol } from ".";
import { ISymbolContainer } from './ISymbolContainer';

export class UCStructSymbol extends UCFieldSymbol implements ISymbolContainer<ISymbol> {
	public extendsType?: UCTypeSymbol;
	public super?: UCStructSymbol;
	public children?: UCFieldSymbol;
	public block?: UCBlock;

	/**
	 * Types that are declared within this struct's body.
	 */
	public declaredTypes?: Map<string, UCFieldSymbol>;

	getKind(): SymbolKind {
		return SymbolKind.Namespace;
	}

	getCompletionItemKind(): CompletionItemKind {
		return CompletionItemKind.Module;
	}

	getCompletionSymbols(document: UCDocument) {
		const symbols: ISymbol[] = [];
		for (let child = this.children; child; child = child.next) {
			if (child.acceptCompletion(document, this)) {
				symbols.push(child);
			}
		}

		let parent = this.super || this.outer as UCStructSymbol;
		for (; parent; parent = parent.super || parent.outer as UCStructSymbol) {
			for (let child = parent.children; child; child = child.next) {
				if (child.acceptCompletion(document, this)) {
					symbols.push(child);
				}
			}
		}
		return symbols;
	}

	getCompletionContext(position: Position) {
		for (let symbol = this.children; symbol; symbol = symbol.next) {
			if (intersectsWith(symbol.getSpanRange(), position)) {
				return symbol.getCompletionContext(position);
			}
		}

		if (this.block) {
			const symbol = this.block.getSymbolAtPos(position);
			if (symbol) {
				return symbol;
			}
		}
		return this;
	}

	getContainedSymbolAtPos(position: Position) {
		if (this.extendsType && this.extendsType.getSymbolAtPos(position)) {
			return this.extendsType;
		}

		if (this.block) {
			const symbol = this.block.getSymbolAtPos(position);
			if (symbol) {
				return symbol;
			}
		}

		return this.getChildSymbolAtPos(position);
	}

	getChildSymbolAtPos(position: Position) {
		for (let child = this.children; child; child = child.next) {
			const innerSymbol = child.getSymbolAtPos(position);
			if (innerSymbol) {
				return innerSymbol;
			}
		}
		return undefined;
	}

	addSymbol(symbol: UCFieldSymbol): string | undefined {
		symbol.outer = this;
		symbol.next = this.children;
		symbol.containingStruct = this;
		this.children = symbol;

		if (symbol.isType()) {
			if (!this.declaredTypes) {
				this.declaredTypes = new Map();
			}

			const key = symbol.getId();
			this.declaredTypes.set(key, symbol);
			return key;
		}

		// No key
		return undefined;
	}

	getSymbol(id: string): UCSymbol | undefined {
		return this.findSymbol(id);
	}

	findSymbol(id: string): UCSymbol | undefined {
		for (let child = this.children; child; child = child.next) {
			const name = child.getId();
			if (name === id) {
				return child;
			}
		}
		return undefined;
	}

	findSuperSymbol(id: string): UCSymbol | undefined {
		const symbol = this.findSymbol(id) || this.super && this.super.findSuperSymbol(id);
		if (symbol) {
			return symbol;
		}

		// We should check for ourselves as LAST
		// -- e.g. consider that we have a class named Pickup, and within that class we have a state named Pickup,
		// -- and another state that extends Pickup, then this would return "this" before we get to match the state named "Pickup".
		if (id === this.getId()) {
			return this;
		}

		return undefined;
	}

	findTypeSymbol(id: string, deepSearch: boolean): UCSymbol | undefined {
		if (this.declaredTypes) {
			const symbol = this.declaredTypes.get(id);
			if (symbol) {
				return symbol;
			}
		}
		return this.super && this.super.findTypeSymbol(id, deepSearch);
	}

	index(document: UCDocument, context: UCStructSymbol) {
		super.index(document, context);
		if (this.extendsType) {
			this.extendsType.index(document, context);
			// Ensure that we don't overwrite super assignment from our descendant class.
			if (!this.super) {
				this.super = this.extendsType.getReference() as UCStructSymbol;
			}
		}

		// FIXME: Optimize. We have to index types before anything else but properties ALSO have to be indexed before any method can be indexed properly!
		// FIXME: ReplicationBlock is also indexed before property types are linked!
		if (this.children) {
			// Link types before any child so that a child that referrers one of our types can be linked properly!
			if (this.declaredTypes) {
				for (let type of this.declaredTypes.values()) {
					type.index(document, this);
				}
			}

			// Index all properties foremost as we need their resolved types.
			for (let child: undefined | UCFieldSymbol = this.children; child; child = child.next) {
				if (child instanceof UCPropertySymbol) {
					child.index(document, this);
				}
			}

			for (let child: undefined | UCFieldSymbol = this.children; child; child = child.next) {
				if (child instanceof UCMethodSymbol) {
					child.index(document, this);
				}
			}

			for (let child: undefined | UCFieldSymbol = this.children; child; child = child.next) {
				if (child.isType() || child instanceof UCPropertySymbol || child instanceof UCMethodSymbol) {
					continue;
				}

				child.index(document, this);
			}
		}

		if (this.block) this.block.index(document, this);
	}

	analyze(document: UCDocument, context: UCStructSymbol) {
		if (this.extendsType) {
			this.extendsType.analyze(document, context);
		}

		for (let child = this.children; child; child = child.next) {
			child.analyze(document, this);
		}

		if (this.block) this.block.analyze(document, this);
	}

	accept<Result>(visitor: SymbolWalker<Result>): Result {
		return visitor.visitStruct(this);
	}
}