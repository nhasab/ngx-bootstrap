/* tslint:disable:max-file-line-count */
import {
  ChangeDetectorRef,
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  TemplateRef,
  ViewContainerRef
} from '@angular/core';
import { NgControl } from '@angular/forms';

import { from, Subscription, isObservable, Observable } from 'rxjs';
import { ComponentLoader, ComponentLoaderFactory } from 'ngx-bootstrap/component-loader';
import { debounceTime, filter, mergeMap, switchMap, toArray } from 'rxjs/operators';

import { TypeaheadContainerComponent } from './typeahead-container.component';
import { TypeaheadMatch } from './typeahead-match.class';
import { TypeaheadConfig } from './typeahead.config';
import { getValueFromObject, latinize, tokenize } from './typeahead-utils';
import { TypeaheadOrder } from './typeahead-order.class';

type TypeaheadOption = string | {[key in string | number]: any};
type Typeahead = TypeaheadOption[] | Observable<TypeaheadOption[]>;

@Directive({selector: '[typeahead]', exportAs: 'bs-typeahead'})
export class TypeaheadDirective implements OnInit, OnDestroy {
  /** options source, can be Array of strings, objects or
   * an Observable for external matching process
   */
  @Input() typeahead: Typeahead;
  /** minimal no of characters that needs to be entered before
   * typeahead kicks-in. When set to 0, typeahead shows on focus with full
   * list of options (limited as normal by typeaheadOptionsLimit)
   */
  @Input() typeaheadMinLength: number = void 0;
  /** sets use adaptive position */
  @Input() adaptivePosition: boolean;
  /** turn on/off animation */
  @Input() isAnimated = false;
  /** minimal wait time after last character typed before typeahead kicks-in */
  @Input() typeaheadWaitMs: number;
  /** maximum length of options items list. The default value is 20 */
  @Input() typeaheadOptionsLimit: number;
  /** when options source is an array of objects, the name of field
   * that contains the options value, we use array item as option in case
   * of this field is missing. Supports nested properties and methods.
   */
  @Input() typeaheadOptionField: string;
  /** when options source is an array of objects, the name of field that
   * contains the group value, matches are grouped by this field when set.
   */
  @Input() typeaheadGroupField: string;
  /** Used to specify a custom order of matches. When options source is an array of objects
   * a field for sorting has to be set up. In case of options source is an array of string,
   * a field for sorting is absent. The ordering direction could be changed to ascending or descending.
   */
  @Input() typeaheadOrderBy: TypeaheadOrder;
  /** should be used only in case of typeahead attribute is Observable of array.
   * If true - loading of options will be async, otherwise - sync.
   * true make sense if options array is large.
   */
  @Input() typeaheadAsync: boolean = void 0;
  /** match latin symbols.
   * If true the word súper would match super and vice versa.
   */
  @Input() typeaheadLatinize = true;
  /** Can be use to search words by inserting a single white space between each characters
   *  for example 'C a l i f o r n i a' will match 'California'.
   */
  @Input() typeaheadSingleWords = true;
  /** should be used only in case typeaheadSingleWords attribute is true.
   * Sets the word delimiter to break words. Defaults to space.
   */
  @Input() typeaheadWordDelimiters = ' ';
  /** should be used only in case typeaheadSingleWords attribute is true.
   * Sets the word delimiter to match exact phrase.
   * Defaults to simple and double quotes.
   */
  @Input() typeaheadPhraseDelimiters = '\'"';
  /** used to specify a custom item template.
   * Template variables exposed are called item and index;
   */
    // tslint:disable-next-line:no-any
  @Input() typeaheadItemTemplate: TemplateRef<any>;
  /** used to specify a custom options list template.
   * Template variables: matches, itemTemplate, query
   */
    // tslint:disable-next-line:no-any
  @Input() optionsListTemplate: TemplateRef<any>;
  /** specifies if typeahead is scrollable  */
  @Input() typeaheadScrollable = false;
  /** specifies number of options to show in scroll view  */
  @Input() typeaheadOptionsInScrollableView = 5;
  /** used to hide result on blur */
  @Input() typeaheadHideResultsOnBlur: boolean;
  /** fired when an options list was opened and the user clicked Tab
   * If a value equal true, it will be chosen first or active item in the list
   * If value equal false, it will be chosen an active item in the list or nothing
   */
  @Input() typeaheadSelectFirstItem = true;
  /** makes active first item in a list */
  @Input() typeaheadIsFirstItemActive = true;
  /** fired when 'busy' state of this component was changed,
   * fired on async mode only, returns boolean
   */
  @Output() typeaheadLoading = new EventEmitter<boolean>();
  /** fired on every key event and returns true
   * in case of matches are not detected
   */
  @Output() typeaheadNoResults = new EventEmitter<boolean>();
  /** fired when option was selected, return object with data of this option */
  @Output() typeaheadOnSelect = new EventEmitter<TypeaheadMatch>();
  /** fired when blur event occurs. returns the active item */
  @Output() typeaheadOnBlur = new EventEmitter<TypeaheadMatch>();

  /**
   * A selector specifying the element the typeahead should be appended to.
   */
  @Input() container: string;

  /** This attribute indicates that the dropdown should be opened upwards */
  @Input() dropup = false;

  // not yet implemented
  /** if false restrict model values to the ones selected from the popup only will be provided */
  // @Input() protected typeaheadEditable:boolean;
  /** if false the first match automatically will not be focused as you type */
  // @Input() protected typeaheadFocusFirst:boolean;
  /** format the ng-model result after selection */
  // @Input() protected typeaheadInputFormatter:any;
  /** if true automatically select an item when there is one option that exactly matches the user input */
  // @Input() protected typeaheadSelectOnExact:boolean;
  /**  if true select the currently highlighted match on blur */
  // @Input() protected typeaheadSelectOnBlur:boolean;
  /**  if false don't focus the input element the typeahead directive is associated with on selection */
    // @Input() protected typeaheadFocusOnSelect:boolean;

  _container: TypeaheadContainerComponent;
  isActiveItemChanged = false;
  isFocused = false;
  cancelRequestOnFocusLost = false;

  // tslint:disable-next-line:no-any
  protected keyUpEventEmitter: EventEmitter<string> = new EventEmitter();
  protected _matches: TypeaheadMatch[];
  protected placement = 'bottom-left';

  private _typeahead: ComponentLoader<TypeaheadContainerComponent>;
  private _subscriptions: Subscription[] = [];
  private _outsideClickListener: Function;

  constructor(
    cis: ComponentLoaderFactory,
    config: TypeaheadConfig,
    private changeDetection: ChangeDetectorRef,
    private element: ElementRef,
    private ngControl: NgControl,
    private renderer: Renderer2,
    viewContainerRef: ViewContainerRef
  ) {

    this._typeahead = cis.createLoader<TypeaheadContainerComponent>(
      element,
      viewContainerRef,
      renderer
    )
      .provide({ provide: TypeaheadConfig, useValue: config });

    Object.assign(this,
      {
        typeaheadHideResultsOnBlur: config.hideResultsOnBlur,
        typeaheadCancelRequestOnFocusLost: config.cancelRequestOnFocusLost,
        typeaheadSelectFirstItem: config.selectFirstItem,
        typeaheadIsFirstItemActive: config.isFirstItemActive,
        typeaheadMinLength: config.minLength,
        adaptivePosition: config.adaptivePosition,
        isAnimated: config.isAnimated
      }
    );
  }

  ngOnInit(): void {
    this.typeaheadOptionsLimit = this.typeaheadOptionsLimit || 20;

    this.typeaheadMinLength =
      this.typeaheadMinLength === void 0 ? 1 : this.typeaheadMinLength;

    this.typeaheadWaitMs = this.typeaheadWaitMs || 0;

    // async should be false in case of array
    if (this.typeaheadAsync === undefined && !(isObservable(this.typeahead))) {
      this.typeaheadAsync = false;
    }

    if (isObservable(this.typeahead)) {
      this.typeaheadAsync = true;
    }

    if (this.typeaheadAsync) {
      this.asyncActions();
    } else {
      this.syncActions();
    }
  }

  @HostListener('input', ['$event'])
  // tslint:disable-next-line:no-any
  onInput(e: any): void {
    // For `<input>`s, use the `value` property. For others that don't have a
    // `value` (such as `<span contenteditable="true">`), use either
    // `textContent` or `innerText` (depending on which one is supported, i.e.
    // Firefox or IE).
    const value =
      e.target.value !== undefined
        ? e.target.value
        : e.target.textContent !== undefined
        ? e.target.textContent
        : e.target.innerText;
    if (value != null && value.trim().length >= this.typeaheadMinLength) {
      this.typeaheadLoading.emit(true);
      this.keyUpEventEmitter.emit(e.target.value);
    } else {
      this.typeaheadLoading.emit(false);
      this.typeaheadNoResults.emit(false);
      this.hide();
    }
  }

  @HostListener('keyup', ['$event'])
  onChange(event: KeyboardEvent): void {
    if (this._container) {
      // esc
      /* tslint:disable-next-line: deprecation */
      if (event.keyCode === 27 || event.key === 'Escape') {
        this.hide();

        return;
      }

      // up
      /* tslint:disable-next-line: deprecation */
      if (event.keyCode === 38 || event.key === 'ArrowUp') {
        this.isActiveItemChanged = true;
        this._container.prevActiveMatch();

        return;
      }

      // down
      /* tslint:disable-next-line: deprecation */
      if (event.keyCode === 40 || event.key === 'ArrowDown') {
        this.isActiveItemChanged = true;
        this._container.nextActiveMatch();

        return;
      }

      // enter
      /* tslint:disable-next-line: deprecation */
      if (event.keyCode === 13 || event.key === 'Enter') {
        this._container.selectActiveMatch();

        return;
      }
    }
  }

  @HostListener('click')
  @HostListener('focus')
  onFocus(): void {
    this.isFocused = true;
    if (this.typeaheadMinLength === 0) {
      this.typeaheadLoading.emit(true);
      this.keyUpEventEmitter.emit(this.element.nativeElement.value || '');
    }
  }

  @HostListener('blur')
  onBlur(): void {
    this.isFocused = false;
    if (this._container && !this._container.isFocused) {
      this.typeaheadOnBlur.emit(this._container.active);
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // no container - no problems
    if (!this._container) {
      return;
    }

    /* tslint:disable-next-line: deprecation */
    if (event.keyCode === 9 || event.key === 'Tab' || event.keyCode === 13 || event.key === 'Enter') {
      event.preventDefault();
      if (this.typeaheadSelectFirstItem) {
        this._container.selectActiveMatch();

        return;
      }

      if (!this.typeaheadSelectFirstItem) {
        this._container.selectActiveMatch(this.isActiveItemChanged);
        this.isActiveItemChanged = false;
        this.hide();
      }
    }
  }

  changeModel(match: TypeaheadMatch): void {
    const valueStr: string = match.value;
    this.ngControl.viewToModelUpdate(valueStr);
    (this.ngControl.control).setValue(valueStr);
    this.changeDetection.markForCheck();
    this.hide();
  }

  get matches(): TypeaheadMatch[] {
    return this._matches;
  }

  show(): void {
    this._typeahead
      .attach(TypeaheadContainerComponent)
      .to(this.container)
      .position({attachment: `${this.dropup ? 'top' : 'bottom'} start`})
      .show({
        typeaheadRef: this,
        placement: this.placement,
        animation: false,
        dropup: this.dropup
      });

    this._outsideClickListener = this.renderer.listen('document', 'click', (e: MouseEvent) => {
      if (this.typeaheadMinLength === 0 && this.element.nativeElement.contains(e.target)) {
        return undefined;
      }
      if (!this.typeaheadHideResultsOnBlur || this.element.nativeElement.contains(e.target)) {
        return undefined;
      }
      this.onOutsideClick();
    });

    this._container = this._typeahead.instance;
    this._container.parent = this;
    // This improves the speed as it won't have to be done for each list item

    const normalizedQuery = (this.typeaheadLatinize
      ? latinize(this.ngControl.control.value)
      : this.ngControl.control.value)
      .toString()
      .toLowerCase();

    this._container.query = this.typeaheadSingleWords
      ? tokenize(
        normalizedQuery,
        this.typeaheadWordDelimiters,
        this.typeaheadPhraseDelimiters
      )
      : normalizedQuery;

    this._container.matches = this._matches;
    this.element.nativeElement.focus();
  }

  hide(): void {
    if (this._typeahead.isShown) {
      this._typeahead.hide();
      this._outsideClickListener();
      this._container = null;
    }
  }

  onOutsideClick(): void {
    if (this._container && !this._container.isFocused) {
      this.hide();
    }
  }

  ngOnDestroy() {
    // clean up subscriptions
    for (const sub of this._subscriptions) {
      sub.unsubscribe();
    }
    this._typeahead.dispose();
  }

  protected asyncActions(): void {
    this._subscriptions.push(
      this.keyUpEventEmitter
        .pipe(
          debounceTime<string>(this.typeaheadWaitMs),
          switchMap(() => this.typeahead)
        )
        .subscribe((matches: TypeaheadOption[]) => {
          this.finalizeAsyncCall(matches);
        })
    );
  }

  protected syncActions(): void {
    this._subscriptions.push(
      this.keyUpEventEmitter
        .pipe(
          debounceTime<string>(this.typeaheadWaitMs),
          mergeMap((value: string) => {
            const normalizedQuery = this.normalizeQuery(value);

            return from(this.typeahead)
              .pipe(
                filter((option: TypeaheadOption) => {
                  return option && this.testMatch(this.normalizeOption(option), normalizedQuery);
                }),
                toArray()
              );
          })
        )
        .subscribe((matches: TypeaheadOption[]) => {
          this.finalizeAsyncCall(matches);
        })
    );
  }

  protected normalizeOption(option: TypeaheadOption): string {
    const optionValue: string = getValueFromObject(
      option,
      this.typeaheadOptionField
    );
    const normalizedOption = this.typeaheadLatinize
      ? latinize(optionValue)
      : optionValue;

    return normalizedOption.toLowerCase();
  }

  protected normalizeQuery(value: string): string | string[] {
    // If singleWords, break model here to not be doing extra work on each iteration
    let normalizedQuery: string | string[] = (this.typeaheadLatinize
      ? latinize(value)
      : value)
      .toString()
      .toLowerCase();
    normalizedQuery = this.typeaheadSingleWords
      ? tokenize(
        normalizedQuery,
        this.typeaheadWordDelimiters,
        this.typeaheadPhraseDelimiters
      )
      : normalizedQuery;

    return normalizedQuery;
  }

  protected testMatch(match: string, test: string[] | string): boolean {
    let spaceLength: number;

    if (typeof test === 'object') {
      spaceLength = test.length;
      for (let i = 0; i < spaceLength; i += 1) {
        if (test[i].length > 0 && match.indexOf(test[i]) < 0) {
          return false;
        }
      }

      return true;
    }

    return match.indexOf(test) >= 0;
  }

  protected finalizeAsyncCall(matches: TypeaheadOption[]): void {
    this.prepareMatches(matches || []);

    this.typeaheadLoading.emit(false);
    this.typeaheadNoResults.emit(!this.hasMatches());

    if (!this.hasMatches()) {
      this.hide();

      return;
    }

    if (!this.isFocused && this.cancelRequestOnFocusLost) {
      return;
    }

    if (this._container) {
      // fix: remove usage of ngControl internals
      const _controlValue = (this.typeaheadLatinize
        ? latinize(this.ngControl.control.value)
        : this.ngControl.control.value) || '';

      // This improves the speed as it won't have to be done for each list item
      const normalizedQuery = _controlValue.toString().toLowerCase();

      this._container.query = this.typeaheadSingleWords
        ? tokenize(
          normalizedQuery,
          this.typeaheadWordDelimiters,
          this.typeaheadPhraseDelimiters
        )
        : normalizedQuery;
      this._container.matches = this._matches;
    } else {
      this.show();
    }
  }

  protected prepareMatches(options: TypeaheadOption[]): void {
    const limited = options.slice(0, this.typeaheadOptionsLimit);
    const sorted = !this.typeaheadOrderBy ? limited : this.orderMatches(limited);

    if (this.typeaheadGroupField) {
      let matches: TypeaheadMatch[] = [];

      // extract all group names
      const groups = sorted
        .map((option: TypeaheadMatch) =>
          getValueFromObject(option, this.typeaheadGroupField)
        )
        .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

      groups.forEach((group: string) => {
        // add group header to array of matches
        matches.push(new TypeaheadMatch(group, group, true));

        // add each item of group to array of matches
        matches = matches.concat(
          sorted
            .filter((option: TypeaheadOption) =>
              getValueFromObject(option, this.typeaheadGroupField) === group
            )
            .map((option: TypeaheadOption) =>
              new TypeaheadMatch(
                option,
                getValueFromObject(option, this.typeaheadOptionField)
              )
            )
        );
      });

      this._matches = matches;
    } else {
      this._matches = sorted.map(
        // tslint:disable-next-line:no-any
        (option: any) =>
          new TypeaheadMatch(
            option,
            getValueFromObject(option, this.typeaheadOptionField)
          )
      );
    }
  }

  protected orderMatches(options: TypeaheadOption[]): TypeaheadOption[] {
    if (!options.length) {
      return options;
    }

    if (this.typeaheadOrderBy !== null
      && this.typeaheadOrderBy !== undefined
      && typeof this.typeaheadOrderBy === 'object'
      && Object.keys(this.typeaheadOrderBy).length === 0) {
      // tslint:disable-next-line:no-console
      console.error('Field and direction properties for typeaheadOrderBy have to be set according to documentation!');

      return options;
    }

    const { field, direction } = this.typeaheadOrderBy;

    if (!direction || !(direction === 'asc' || direction === 'desc')) {
      // tslint:disable-next-line:no-console
      console.error('typeaheadOrderBy direction has to equal "asc" or "desc". Please follow the documentation.');

      return options;
    }

    if (typeof options[0] === 'string') {
      return direction === 'asc' ? options.sort() : options.sort().reverse();
    }

    if (!field || typeof field !== 'string') {
      // tslint:disable-next-line:no-console
      console.error('typeaheadOrderBy field has to set according to the documentation.');

      return options;
    }

    return options.sort((a: TypeaheadOption, b: TypeaheadOption) => {
      const stringA = getValueFromObject(a, field);
      const stringB = getValueFromObject(b, field);

      if (stringA < stringB) {
        return direction === 'asc' ? -1 : 1;
      }

      if (stringA > stringB) {
        return direction === 'asc' ? 1 : -1;
      }

      return 0;
    });
  }

  protected hasMatches(): boolean {
    return this._matches.length > 0;
  }
}
