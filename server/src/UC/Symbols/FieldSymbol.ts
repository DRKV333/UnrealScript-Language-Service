import { Location, Position, Range } from 'vscode-languageserver-types';

import { UCDocument } from '../document';
import { intersectsWith, intersectsWithRange } from '../helpers';
import { Identifier, ISymbol, ITypeSymbol, UCStructSymbol, UCSymbol } from './';
import { SymbolReference } from './ISymbol';

export enum FieldModifiers {
	None 				= 0x0000,
	Protected 			= 0x0001,
	Private 			= 0x0002,
	Native 				= 0x0004,
	ReadOnly 			= 0x0008,
	WithDimension		= 0x0010,
    // Not to be confused with the alternative keyword of "Native"
    Intrinsic           = 0x0020,
    Generated           = 0x0040,
    Transient           = 0x0080,
	NotPublic 			= Protected | Private,
}

export abstract class UCFieldSymbol extends UCSymbol {
    outer: ISymbol;

	public next?: UCFieldSymbol;
	public containingStruct?: UCStructSymbol;

	public modifiers: FieldModifiers = FieldModifiers.None;

	constructor(id: Identifier, private readonly range: Range = id.range) {
		super(id);
	}

	getRange(): Range {
		return this.range;
	}

	getType(): ITypeSymbol | undefined {
		return undefined;
	}

	protected getTypeKeyword(): string | undefined {
		return undefined;
	}

	getTooltip(): string {
		return this.getPath();
	}

	getSymbolAtPos(position: Position) {
		if (!intersectsWith(this.getRange(), position)) {
			return undefined;
		}

		if (intersectsWithRange(position, this.id.range)) {
			return this;
		}
		return this.getContainedSymbolAtPos(position);
	}

	getCompletionContext(_position: Position): ISymbol | undefined {
		return undefined;
	}

	isPublic(): boolean {
		return (this.modifiers & FieldModifiers.NotPublic) === 0;
	}

	isPrivate(): boolean {
		return (this.modifiers & FieldModifiers.Private) !== 0;
	}

	isProtected(): boolean {
		return (this.modifiers & FieldModifiers.Protected) !== 0;
	}

	isReadOnly(): boolean {
		return (this.modifiers & FieldModifiers.ReadOnly) !== 0;
	}

	isNative(): boolean {
		return (this.modifiers & FieldModifiers.Native) !== 0;
	}

    /**
	 * Returns true if this property is declared as a static array type (false if it's dynamic!).
	 * Note that this property will be seen as a static array even if the @arrayDim value is invalid.
	 */
	isFixedArray(): boolean {
		return (this.modifiers & FieldModifiers.WithDimension) === FieldModifiers.WithDimension;
	}

	acceptCompletion(_document: UCDocument, _context: ISymbol): boolean {
		return true;
	}

	index(document: UCDocument, _context: UCStructSymbol) {
		this.indexDeclaration(document);
	}

	private indexDeclaration(document: UCDocument) {
		const ref: SymbolReference = {
			location: Location.create(document.uri, this.id.range),
			inAssignment: true
		};
		document.indexReference(this, ref);
	}

	protected buildModifiers(modifiers = this.modifiers): string[] {
		const text: string[] = [];

		if (modifiers & FieldModifiers.Native) {
			text.push('native');
		}

        if (modifiers & FieldModifiers.Transient) {
            text.push('transient');
        }

		if (modifiers & FieldModifiers.Protected) {
			text.push('protected');
		}
		else if (modifiers & FieldModifiers.Private) {
			text.push('private');
		}

		return text;
	}

    // TODO: Merge with buildModifiers(), but for now this quick workaround will suffice
	public buildModifiersWith(modifiers: FieldModifiers): string[] {
        return this.buildModifiers(modifiers);
    }
}