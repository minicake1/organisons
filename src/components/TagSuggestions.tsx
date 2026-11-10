import { ActionIcon, Badge, Group, Text, Tooltip } from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'

/**
 * Tags détectés dans le titre et les métadonnées du GPX : rien n'est ajouté
 * sans un clic. « + » ajoute le tag, « × » ne le propose plus.
 */
export default function TagSuggestions({
  suggestions,
  onAdd,
  onIgnore,
  label = 'Tags proposés',
}: {
  suggestions: string[]
  onAdd: (tags: string[]) => void
  onIgnore: (tags: string[]) => void
  label?: string
}) {
  if (!suggestions.length) return null
  return (
    <Group gap={6} align="center">
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      {suggestions.map((s) => (
        <Badge
          key={s}
          variant="outline"
          color="gray"
          tt="none"
          pr={2}
          leftSection={
            <Tooltip label={`Ajouter « ${s} »`}>
              <ActionIcon size={16} variant="subtle" color="blue" aria-label={`Ajouter le tag ${s}`} onClick={() => onAdd([s])}>
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          }
          rightSection={
            <Tooltip label="Ne plus proposer">
              <ActionIcon size={16} variant="subtle" color="gray" aria-label={`Ne plus proposer ${s}`} onClick={() => onIgnore([s])}>
                <IconX size={12} />
              </ActionIcon>
            </Tooltip>
          }
        >
          {s}
        </Badge>
      ))}
      {suggestions.length > 1 && (
        <Text size="xs" c="blue" style={{ cursor: 'pointer' }} onClick={() => onAdd(suggestions)}>
          Tout ajouter
        </Text>
      )}
    </Group>
  )
}
