export function FormatMoney({ value }: { value: number }) {
  if (value === 0) return <>Free</>
  return <>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)}</>
}
