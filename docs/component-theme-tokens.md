# Shared component state tokens

Checkpoint 189, 25 October 2026. The existing semantic theme now includes typed, deeply frozen button, field and card state tokens, shared help/error/selected feedback and a dual focus ring. This is additive to `semantic-theme-v1`: existing palette values, typography, spacing, radii, minimum control size, CSS aliases and full-brand validation remain compatible. Theme data still grants no company/data authority and requires no fabricated production manifest.

`createBrandTheme` composes the tokens from validated public palette colors. `createTenantTheme` uses the same presentation output after its existing strict full-brand validation. The synthetic demo registry continues using palette-only composition. No company name, contact, arbitrary CSS, secret, role or property identity enters generated CSS.

## Typed contract

The shared exports are `ComponentState`, `ComponentColorTokens`, `ComponentTokens` and `ComponentThemeTokens`. `theme.components` contains:

| Member                           | Contract                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `button`, `field`, `card`        | `default`, `hover`, `pressed`, `disabled`, `focus`, `selected`, each with `background`, `foreground`, `border` |
| Each component's numeric metrics | `minHeight`, `paddingX`, `paddingY`, `radius`, `fontSize`, `lineHeight`, `fontWeight`                          |
| `feedback`                       | `help`, `error`, `selected`, each using the same color triplet                                                 |
| `focus`                          | `color`, `gapColor`, numeric `width` and `offset`                                                              |

Every nested object is detached and frozen. Native consumers receive numbers for dimensions and can select a state explicitly. CSS consumers use fixed aliases rather than reading tenant colors into individual component styles.

Buttons use the semantic primary pair by default, secondary pair on hover, dark surface pair while pressed and a readable muted pair while disabled. Selected feedback uses the primary pair. Fields and cards retain readable surface-based pairs; selection uses a contrasting brand-derived border, falling back to the dark surface foreground when the brand cannot provide a 3:1 boundary against that particular surface. Cards use the existing 12-unit radius and 24-unit padding. Button/field metrics retain the 48-unit minimum control height, 8-unit radius, 16/24 body typography and existing spacing scale. Cards are containers and do not acquire a minimum interactive target merely by having state tokens.

The additive semantic colors `mutedSurface`, `onMutedSurface`, `border`, `error`, `errorSurface` and `onErrorSurface` separate status/help feedback from decorative brand colors. Errors do not depend on the agency's primary color. Disabled text remains readable; consumers do not fade the entire control with opacity. A disabled appearance does not disable a click handler: controls still need their existing native disabled/authorization semantics.

## CSS aliases and public consumption

`brandThemeCss` and `tenantThemeCss` add these fixed aliases, preserving their earlier variables:

- `--{button|field|card}-{default|hover|pressed|disabled|focus|selected}-{background|foreground|border}`.
- `--{button|field|card}-{min-height|padding-x|padding-y|radius|font-size|line-height}` in pixels, plus unitless `--{button|field|card}-font-weight`.
- `--feedback-{help|error|selected}-{background|foreground|border}`.
- `--focus-ring-{color|gap-color}` and pixel values `--focus-ring-{width|offset}`.

The existing public root already installs the CSS adapter. A bounded public stylesheet adoption now uses these aliases for primary actions, search inputs/selects, helper/error feedback, selected purpose tabs, property cards and public-information cards. Fields and primary actions preserve the shared 48-pixel minimum at narrow breakpoints. Field errors retain existing `aria-invalid`/described-by behavior. Purpose tabs remain the existing radio controls; selected, disabled, pressed and keyboard-focus appearances do not replace those semantics. Cards retain their existing links and do not become buttons or acquire fake selection/disabled attributes.

Focus uses a 3-unit dark outer ring with a 3-unit light gap, rather than applying a brand-colored outline against the same brand fill. Both ring colors are semantic surface colors, and the pair remains distinguishable at light/dark palette extremes. Consumers need both parts when reproducing the dual ring; a lone token color is not a guarantee against every surrounding background. Focus remains visible while button hover/pressed colors change. Existing unrelated gallery overlays, secondary controls and layout styling remain outside this bounded migration.

The stylesheet stays in the existing root import, following the bundled Next.js global-CSS ordering guidance. Actual production CSS order, responsive layout, pointer/keyboard state transitions, forced colors, assistive technology and native device behavior still require rendered verification. Token color-pair checks are not complete accessibility conformance.

## Verification scope

New domain cases check every component/feedback text pair at 4.5:1, relevant boundaries at 3:1, dual-ring contrast, both synthetic brands, light/dark extremes and a low-contrast brand requiring a surface-specific border fallback. Tests also check unchanged numeric scales, meaningful button state differences, deep freezing/detachment and complete CSS/native alias parity. Full-manifest and palette-only composition must yield the same component presentation.

Sequential verification under a 384 MiB heap passed: domain/demo builds, all 289 domain checks (including four new component-theme cases), all 12 demo checks, mobile test compilation and two new native style-adapter checks, all 81 web checks with compilation, and admin/web/mobile TypeScript. A static audit confirms all 79 component variables referenced by the adopted public/admin styles resolve in both configured synthetic brands. Counts include existing checks. The initial domain build inferred the default surface parameter as the literal white color; annotating that parameter as `string` fixed the type error without changing runtime comparisons. The failed build log is retained. Source review also corrected two native pairings before execution: header text against its actual surface, and the dual focus ring without replacing pressed colors.

These results establish shared token creation and representative consumption, not rendered state, native-device, complete accessibility, operator UAT, hosted or cutover acceptance. Task03-3 asks for shared color, typography, spacing and component tokens; its literal creation evidence can be assessed separately from those broader gates. KES 10,000 remains the total monthly baseline, and vendor/old live resources remain unchanged.
