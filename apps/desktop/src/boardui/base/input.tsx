// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/input/input.tsx.
// Tayfa changes: imports only.
import { createContext, useContext, type ComponentType, type ReactNode, type Ref } from 'react';
import {
  Group as AriaGroup,
  Input as AriaInput,
  TextField as AriaTextField,
  useLocale,
} from 'react-aria-components';
import type {
  InputProps as AriaInputProps,
  TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components';
import { HintText } from '@boardui/base/hint-text';
import { Label } from '@boardui/base/label';
import { cx, sortCx } from '@boardui/foundations/cx';

/**
 * Text field.
 *   InputBase  the styled shell (React Aria Group + adornments + Input); hover, focus, disabled and
 *              invalid arrive as render-prop state.
 *   TextField  React Aria TextField plus a context that passes size and classes down.
 *   Input      TextField > Label > InputBase > HintText, the composition most callers use.
 * React Aria wires label, hint and error to the input (aria-labelledby/-describedby, aria-invalid).
 */

export type InputSize = 'medium' | 'small';

type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface TextFieldContextValue {
  size?: InputSize;
  fieldClassName?: string;
  inputClassName?: string;
}

/** Shared by every field that uses Input's shell, so a composed form stays consistent. */
export const TextFieldContext = createContext<TextFieldContextValue>({});

export interface TextFieldProps
  extends Omit<AriaTextFieldProps, 'className'>, TextFieldContextValue {
  className?: string;
  children?:
    | ReactNode
    | ((state: {
        isRequired: boolean;
        isInvalid: boolean;
        isDisabled: boolean;
        isReadOnly: boolean;
      }) => ReactNode);
}

export function TextField({
  size = 'medium',
  fieldClassName,
  inputClassName,
  className,
  children,
  ...props
}: TextFieldProps) {
  return (
    <TextFieldContext.Provider value={{ size, fieldClassName, inputClassName }}>
      <AriaTextField
        {...props}
        data-input-size={size}
        className={cx('group flex h-max w-full flex-col items-start gap-1', className)}
      >
        {children as never /* React Aria accepts render-prop children */}
      </AriaTextField>
    </TextFieldContext.Provider>
  );
}

TextField.displayName = 'TextField';

export interface InputBaseProps extends Omit<AriaInputProps, 'size' | 'className'> {
  size?: InputSize;
  className?: string;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  /** Custom element rendered in the leading slot. */
  leadingAddon?: ReactNode;
  /** Class for the field shell. */
  fieldClassName?: string;
  /** Ref to the <input> element. */
  ref?: Ref<HTMLInputElement>;
  /** Ref to the field shell wrapper. */
  groupRef?: Ref<HTMLDivElement>;
}

const inputStyles = sortCx({
  field: [
    'relative flex w-full items-center',
    'rounded-2lg',
    'bg-background-tertiary-default text-foreground-icon-tertiary',
    'ring-2 ring-inset ring-transparent',
    'transition-[background-color,box-shadow,color] duration-[var(--input-transition-ms)] ease',
  ].join(' '),

  fieldSize: {
    medium: 'p-2',
    small: 'h-8 px-1.5 py-2',
  },

  // A leading addon tightens the start padding.
  fieldWithAddonSize: {
    medium: 'h-9 ps-1 pe-2 py-2',
    small: 'h-8 ps-1 pe-1.5 py-2',
  },

  content: 'flex w-full items-center gap-2 min-w-0',
  leftSection: 'flex flex-1 items-center gap-0.5 min-w-0',

  input: [
    'min-w-0 flex-1 bg-transparent border-0 outline-none p-0 m-0',
    'font-sans text-body-regular text-text-primary',
    'placeholder:text-text-tertiary',
    'focus:placeholder:text-text-primary',
    'disabled:text-input-disabled-text disabled:placeholder:text-input-disabled-text',
    'disabled:cursor-not-allowed',
    'aria-invalid:placeholder:text-text-error-placeholder',
  ].join(' '),

  icon: 'size-5 shrink-0',
});

export function InputBase({
  size: sizeProp,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  leadingAddon,
  fieldClassName,
  className,
  ref,
  groupRef,
  ...inputProps
}: InputBaseProps) {
  const { direction } = useLocale();
  const ctx = useContext(TextFieldContext);
  const size: InputSize = sizeProp ?? ctx.size ?? 'medium';
  const hasAddon = leadingAddon !== undefined && leadingAddon !== null;

  return (
    <AriaGroup
      ref={groupRef}
      className={({ isFocusWithin, isHovered, isDisabled, isInvalid }) =>
        cx(
          inputStyles.field,
          hasAddon ? inputStyles.fieldWithAddonSize[size] : inputStyles.fieldSize[size],
          isHovered && !isFocusWithin && !isDisabled && !isInvalid && 'ring-border-button-hover',
          isFocusWithin && !isDisabled && !isInvalid && 'ring-border-button-active',
          isDisabled && 'bg-input-disabled-background text-input-disabled-foreground',
          isInvalid && 'bg-background-tertiary-error text-foreground-icon-error',
          ctx.fieldClassName,
          fieldClassName,
        )
      }
    >
      <div className={inputStyles.content}>
        <div className={inputStyles.leftSection}>
          {hasAddon ? (
            leadingAddon
          ) : Leading ? (
            <Leading className={inputStyles.icon} aria-hidden />
          ) : null}
          <AriaInput
            ref={ref}
            {...inputProps}
            // Align to the field's start even when email/URL values use LTR.
            className={cx(
              inputStyles.input,
              direction === 'rtl' ? 'pr-1 text-right' : 'pl-1 text-left',
              ctx.inputClassName,
              className,
            )}
          />
        </div>
        {Trailing ? <Trailing className={inputStyles.icon} aria-hidden /> : null}
      </div>
    </AriaGroup>
  );
}

InputBase.displayName = 'InputBase';

export interface InputProps
  extends
    Omit<TextFieldProps, 'children'>,
    Pick<
      InputBaseProps,
      'leadingIcon' | 'trailingIcon' | 'leadingAddon' | 'fieldClassName' | 'groupRef' | 'ref'
    > {
  label?: ReactNode;
  hint?: ReactNode;
  /** Show an info glyph next to the label. */
  tooltip?: boolean | string;
  placeholder?: string;
  /** Direction of the editable value; email, URL and phone default to LTR. */
  inputDir?: 'ltr' | 'rtl' | 'auto';
}

export function Input({
  label,
  hint,
  tooltip,
  placeholder,
  inputDir,
  leadingIcon,
  trailingIcon,
  leadingAddon,
  fieldClassName,
  ref,
  groupRef,
  className,
  ...textFieldProps
}: InputProps) {
  return (
    <TextField
      {...textFieldProps}
      className={className}
      // Keep an explicit aria-label; fall back to the placeholder only for unlabelled fields.
      aria-label={
        textFieldProps['aria-label'] ??
        (!label && typeof placeholder === 'string' ? placeholder : undefined)
      }
    >
      {({ isRequired, isInvalid }) => (
        <>
          {label && (
            <Label isRequired={isRequired} isInvalid={isInvalid} tooltip={tooltip}>
              {label}
            </Label>
          )}
          <InputBase
            dir={
              inputDir ??
              (['email', 'url', 'tel'].includes(textFieldProps.type ?? '') ? 'ltr' : undefined)
            }
            ref={ref}
            groupRef={groupRef}
            placeholder={placeholder}
            leadingIcon={leadingIcon}
            trailingIcon={trailingIcon}
            leadingAddon={leadingAddon}
            fieldClassName={fieldClassName}
          />
          {hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}
        </>
      )}
    </TextField>
  );
}

Input.displayName = 'Input';
