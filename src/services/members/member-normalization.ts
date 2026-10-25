/**
 * @fileoverview Lossless typed flat trees for recursive interests and committee relationships.
 * @module services/members/member-normalization
 */
import { z } from '@cyanheads/mcp-ts-core';
import { CommitteeSeatSchema, InterestCategorySchema, InterestSchema } from './member-models.js';

const path = z
  .string()
  .describe('Source JSON pointer identifying this record within its whole pagination atom.');
const paths = z
  .array(path)
  .nullish()
  .describe('Ordered child source pointers; null and omission preserve source absence.');
const state = z
  .enum(['missing', 'null', 'present'])
  .describe('Whether the source nested object was omitted, null or present.');
const text = z
  .string()
  .nullish()
  .describe('Published source text; null and omission remain unknown.');
const integer = z
  .number()
  .int()
  .nullish()
  .describe('Published source identifier, within its own namespace.');
const InterestNodeSchema = InterestSchema.omit({ childInterests: true })
  .extend({
    path,
    parentPath: path
      .optional()
      .describe('Parent declaration pointer; omitted for a root interest.'),
    childPaths: paths,
  })
  .describe('Complete declaration with explicit ordered parent/child associations.');
/** Whole category, with every recursive declaration in a typed flat tree. */
export const FlatInterestCategorySchema = InterestCategorySchema.omit({ interests: true })
  .extend({
    rootPaths: paths.describe(
      'Ordered root declaration pointers; null/omission mirrors source interests.',
    ),
    interests: z
      .array(InterestNodeSchema)
      .nullish()
      .describe('Every descendant declaration, once, in source preorder.'),
  })
  .describe('Whole interest category with reconstructable recursive relationships.');

const RoleSchema = z
  .object({
    startDate: text,
    endDate: text,
    roleState: state,
    roleId: integer,
    roleName: text,
    isChair: z.boolean().nullish().describe('Source role chair flag.'),
    roleTypeState: state,
    roleTypeId: integer,
    roleTypeName: text,
    exOfficio: z.boolean().nullish().describe('Source ex officio flag.'),
    alternate: z.boolean().nullish().describe('Source alternate flag.'),
    coOpted: z.boolean().nullish().describe('Source co-opted flag.'),
  })
  .describe('Whole role period with flattened named role and type metadata.');
const CommitteeTypeSchema = z
  .object({
    id: z.number().int().describe('Source committee type ID.'),
    name: text,
    categoryState: state,
    categoryId: integer,
    categoryName: text,
  })
  .describe('Committee type and complete flattened category metadata.');
/** Committee metadata with source-pointer relationships instead of recursive objects. */
export const FlatCommitteeSchema = CommitteeSeatSchema.omit({
  parentCommittee: true,
  subCommittees: true,
  roles: true,
  committeeTypes: true,
})
  .extend({
    path,
    parentCommitteePath: path
      .nullish()
      .describe('Parent committee source pointer; null/omission is preserved.'),
    subCommitteePaths: paths,
    committeeTypes: z
      .array(CommitteeTypeSchema)
      .nullish()
      .describe('Complete committee types and flattened category metadata.'),
    roles: z
      .array(RoleSchema)
      .nullish()
      .describe('Whole source membership role periods; omitted for related summaries.'),
  })
  .describe('Complete typed committee record with explicit tree relationships.');
/** A single committee seat and every related committee occurrence. */
export const FlatCommitteeSeatSchema = z.object({
  value: FlatCommitteeSchema.describe('Selected root committee seat.'),
  relatedCommittees: z
    .array(FlatCommitteeSchema)
    .describe('Every nested parent/subcommittee occurrence, identified by source pointer.'),
});

/** Preserve every declaration, its ordering and nullable child collection state. */
export function flattenInterestCategory(
  category: z.infer<typeof InterestCategorySchema>,
): z.infer<typeof FlatInterestCategorySchema> {
  const { interests, ...metadata } = category;
  if (interests == null)
    return { ...metadata, ...(interests === null ? { interests: null, rootPaths: null } : {}) };
  const nodes: z.infer<typeof InterestNodeSchema>[] = [];
  const visit = (
    interest: z.infer<typeof InterestSchema>,
    pointer: string,
    parentPath?: string,
  ) => {
    const { childInterests, ...value } = interest;
    const childPaths = childInterests?.map((_, index) => `${pointer}/childInterests/${index}`);
    nodes.push({
      ...value,
      path: pointer,
      ...(parentPath === undefined ? {} : { parentPath }),
      ...(childInterests === null ? { childPaths: null } : childPaths ? { childPaths } : {}),
    });
    childInterests?.forEach((child, index) => {
      visit(child, `${pointer}/childInterests/${index}`, pointer);
    });
  };
  interests.forEach((interest, index) => {
    visit(interest, `/interests/${index}`);
  });
  return {
    ...metadata,
    interests: nodes,
    rootPaths: interests.map((_, index) => `/interests/${index}`),
  };
}

function objectState(value: object | null | undefined): z.infer<typeof state> {
  return value === undefined ? 'missing' : value === null ? 'null' : 'present';
}
/** Preserve all nested committee metadata and exact relationship occurrences without deep output schemas. */
export function flattenCommitteeSeat(
  seat: z.infer<typeof CommitteeSeatSchema>,
): z.infer<typeof FlatCommitteeSeatSchema> {
  const relatedCommittees: z.infer<typeof FlatCommitteeSchema>[] = [];
  const visit = (
    committee: z.infer<typeof CommitteeSeatSchema>,
    pointer: string,
  ): z.infer<typeof FlatCommitteeSchema> => {
    const { parentCommittee, subCommittees, roles, committeeTypes, ...metadata } = committee;
    const value: z.infer<typeof FlatCommitteeSchema> = {
      ...metadata,
      path: pointer,
      ...(parentCommittee === null
        ? { parentCommitteePath: null }
        : parentCommittee
          ? { parentCommitteePath: `${pointer}/parentCommittee` }
          : {}),
      ...(subCommittees === null
        ? { subCommitteePaths: null }
        : subCommittees
          ? {
              subCommitteePaths: subCommittees.map(
                (_, index) => `${pointer}/subCommittees/${index}`,
              ),
            }
          : {}),
      ...(committeeTypes === null
        ? { committeeTypes: null }
        : committeeTypes
          ? {
              committeeTypes: committeeTypes.map(({ committeeCategory, ...type }) => ({
                ...type,
                categoryState: objectState(committeeCategory),
                ...(committeeCategory
                  ? { categoryId: committeeCategory.id, categoryName: committeeCategory.name }
                  : {}),
              })),
            }
          : {}),
      ...(roles === null
        ? { roles: null }
        : roles
          ? {
              roles: roles.map(({ role, ...period }) => ({
                ...period,
                roleState: objectState(role),
                roleTypeState: objectState(role?.roleType),
                ...(role ? { roleId: role.id, roleName: role.name, isChair: role.isChair } : {}),
                ...(role?.roleType
                  ? { roleTypeId: role.roleType.id, roleTypeName: role.roleType.name }
                  : {}),
              })),
            }
          : {}),
    };
    if (parentCommittee)
      relatedCommittees.push(visit(parentCommittee, `${pointer}/parentCommittee`));
    subCommittees?.forEach((child, index) => {
      relatedCommittees.push(visit(child, `${pointer}/subCommittees/${index}`));
    });
    return value;
  };
  const value = visit(seat, '');
  return { value, relatedCommittees };
}
