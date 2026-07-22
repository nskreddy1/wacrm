"use client"

import { useMemo, useState } from "react"
import PhoneNumberInput, { type Value } from "react-phone-number-input/input"
import { getCountries, getCountryCallingCode, isValidPhoneNumber, parsePhoneNumber, type Country } from "react-phone-number-input"
import flags from "react-phone-number-input/flags"
import en from "react-phone-number-input/locale/en.json"
import { Check, ChevronDown, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const COUNTRIES: Country[] = getCountries()

function CountryFlag({ country }: { country: Country }) {
  const Flag = flags[country]
  return (
    <span className="flex h-4 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[3px]">
      {Flag ? <Flag title={en[country] ?? country} /> : <span className="text-[10px] font-semibold">{country}</span>}
    </span>
  )
}

export function InternationalPhoneInput({
  value,
  onChange,
  invalid,
  disabled,
  id = "contact-phone",
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  disabled?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedCountry, setSelectedCountry] = useState<Country>(() => parsePhoneNumber(value)?.country ?? "US")
  const country = parsePhoneNumber(value)?.country ?? selectedCountry

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return COUNTRIES
    return COUNTRIES.filter(
      (code) => (en[code] ?? code).toLocaleLowerCase().includes(term) || `+${getCountryCallingCode(code)}`.includes(term),
    )
  }, [query])

  function selectCountry(next: Country) {
    setSelectedCountry(next)
    setOpen(false)
    setQuery("")
    // Keep only the national digits when switching country so the number re-formats.
    const parsed = parsePhoneNumber(value)
    if (parsed && parsed.country !== next) onChange(`+${getCountryCallingCode(next)}${parsed.nationalNumber}`)
  }

  return (
    <div
      className={cn(
        "flex h-11 w-full items-stretch rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        invalid && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`Country: ${en[country] ?? country}. Change country`}
              className="h-full shrink-0 gap-1.5 rounded-r-none border-r border-input px-3"
            />
          }
        >
          <CountryFlag country={country} />
          <span className="text-sm text-muted-foreground">+{getCountryCallingCode(country)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search country or code"
              aria-label="Search countries"
              className="h-8 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label="Countries">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No countries match your search.</li>
            ) : (
              filtered.map((code) => (
                <li key={code} role="option" aria-selected={code === country}>
                  <button
                    type="button"
                    onClick={() => selectCountry(code)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none",
                      code === country && "bg-accent/50",
                    )}
                  >
                    <CountryFlag country={code} />
                    <span className="min-w-0 flex-1 truncate">{en[code] ?? code}</span>
                    <span className="text-xs text-muted-foreground">+{getCountryCallingCode(code)}</span>
                    {code === country ? <Check className="size-4 text-primary" /> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
      <PhoneNumberInput
        id={id}
        country={country}
        international={false}
        value={value as Value}
        disabled={disabled}
        onChange={(next) => onChange(next ?? "")}
        autoComplete="tel"
        aria-invalid={invalid}
        placeholder="Phone number"
        className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </div>
  )
}

export function validInternationalPhone(value: string) {
  return !value || isValidPhoneNumber(value)
}
