import {
  type AccountCenter,
  AccountCenters,
  nameAndAvatarGuard,
  type SignInExperience,
  SignInExperiences,
  type UpdateCustomProfileFieldData,
  type CustomProfileFieldUnion,
  type UpdateCustomProfileFieldSieOrder,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { trySafe } from '@silverhand/essentials';
import { sql } from '@silverhand/slonik';

import { BaseCache } from '#src/caches/base-cache.js';
import { buildFindEntityByIdWithPool } from '#src/database/find-entity-by-id.js';
import { buildUpdateWhereWithPool } from '#src/database/update-where.js';
import RequestError from '#src/errors/RequestError/index.js';
import { createCustomProfileFieldsQueries } from '#src/queries/custom-profile-fields.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';
import { convertToIdentifiers } from '#src/utils/sql.js';

import { validateCustomProfileFieldData } from './utils.js';

const defaultId = 'default';
const signInExperienceIdentifiers = convertToIdentifiers(SignInExperiences);
const accountCenterIdentifiers = convertToIdentifiers(AccountCenters);

/**
 * [NiceMatrix override] Column-backed built-in profile fields (`name`, `avatar`).
 *
 * Upstream 1.41 seeds the admin account center with `profileFields: [{name}, {avatar}]`
 * (alteration `1.41.0-...-set-admin-account-center-profile-fields`), but
 * `validateProfileFieldsList` checks every referenced name against the
 * `custom_profile_fields` catalog with no built-in exemption. `name`/`avatar` are backed
 * by dedicated `users` columns and are never catalog rows, so saving Sign-in & account
 * always failed with `custom_profile_fields.entity_not_exists_with_names: name, avatar`.
 *
 * We exempt ONLY these two column-backed keys from the missing-name existence check
 * (mirrors upstream's own `name`/`avatar` special-casing in `getProfileFieldControlKey`).
 * Other built-in profile keys (birthdate, gender, nickname, address, ...) ARE legitimate
 * catalog rows in our deployment, so they intentionally stay validated to keep
 * dangling-reference detection intact. The set is derived from `nameAndAvatarGuard` so it
 * auto-tracks any upstream change to those keys.
 */
const columnBackedBuiltInProfileFieldKeys = new Set<string>(nameAndAvatarGuard.keyof().options);

type ProfileFieldsList = ReadonlyArray<{ name: string }>;
type NormalizableProfileFields =
  | SignInExperience['signUpProfileFields']
  | AccountCenter['profileFields']
  | undefined;
type RemovableProfileFields =
  | SignInExperience['signUpProfileFields']
  | AccountCenter['profileFields'];

function removeProfileFieldByName(
  profileFields: SignInExperience['signUpProfileFields'],
  name: string
): SignInExperience['signUpProfileFields'];
function removeProfileFieldByName(
  profileFields: AccountCenter['profileFields'],
  name: string
): AccountCenter['profileFields'];
function removeProfileFieldByName(
  profileFields: RemovableProfileFields,
  name: string
): RemovableProfileFields {
  if (!profileFields) {
    return profileFields;
  }

  return profileFields.filter(({ name: fieldName }) => fieldName !== name);
}

export const createCustomProfileFieldsLibrary = (queries: Queries) => {
  const {
    insertCustomProfileFields,
    findCustomProfileFieldsByNames,
    updateCustomProfileFieldsByName,
    updateFieldOrderInSignInExperience,
    bulkInsertCustomProfileFields,
  } = queries.customProfileFields;

  const createCustomProfileField = async (data: CustomProfileFieldUnion) => {
    validateCustomProfileFieldData(data);

    return insertCustomProfileFields({ ...data, id: generateStandardId() });
  };

  const createCustomProfileFieldsBatch = async (data: CustomProfileFieldUnion[]) => {
    for (const item of data) {
      validateCustomProfileFieldData(item);
    }
    const rows = data.map((item) => ({ ...item, id: generateStandardId() }));
    return bulkInsertCustomProfileFields(rows);
  };

  const updateCustomProfileField = async (name: string, data: UpdateCustomProfileFieldData) => {
    // Use strict validation on update
    validateCustomProfileFieldData({ ...data, name }, true);

    return updateCustomProfileFieldsByName({
      where: { name },
      set: data,
      jsonbMode: 'replace',
    });
  };

  const validateProfileFieldsList = async (fields: ProfileFieldsList) => {
    if (fields.length === 0) {
      return;
    }

    const names = fields.map(({ name }) => name);
    const uniqueNames = [...new Set(names)];
    // [NiceMatrix override] Only catalog-backed names need to exist in `custom_profile_fields`.
    // Column-backed built-ins (`name`, `avatar`) are exempt from the existence check. Skip the
    // catalog query entirely when nothing needs verifying — `findCustomProfileFieldsByNames([])`
    // would emit `where name in ()` (invalid Postgres SQL). The admin default save
    // (`[{name}, {avatar}]`) hits exactly this empty path.
    const namesToVerify = uniqueNames.filter(
      (name) => !columnBackedBuiltInProfileFieldKeys.has(name)
    );
    if (namesToVerify.length > 0) {
      const profileFields = await findCustomProfileFieldsByNames(namesToVerify);
      const existingNames = new Set(profileFields.map(({ name }) => name));
      const missing = namesToVerify.filter((name) => !existingNames.has(name));
      assertThat(
        missing.length === 0,
        new RequestError({
          code: 'custom_profile_fields.entity_not_exists_with_names',
          names: missing.join(', '),
        })
      );
    }

    const duplicateNames = uniqueNames.filter(
      (name) => names.indexOf(name) !== names.lastIndexOf(name)
    );
    assertThat(
      duplicateNames.length === 0,
      new RequestError(
        {
          code: 'request.invalid_input',
          details: `Duplicate profile field names: ${duplicateNames.join(', ')}`,
        },
        { duplicateNames }
      )
    );
  };

  const updateCustomProfileFieldsSieOrder = async (data: UpdateCustomProfileFieldSieOrder[]) => {
    await validateProfileFieldsList(data);

    return updateFieldOrderInSignInExperience(data);
  };

  const deleteCustomProfileField = async (name: string) => {
    const { didUpdateSignInExperience, didUpdateAccountCenter } = await queries.pool.transaction(
      async (connection) => {
        const findSignInExperienceById = buildFindEntityByIdWithPool(connection)(SignInExperiences);
        const updateSignInExperience = buildUpdateWhereWithPool(connection)(
          SignInExperiences,
          true
        );
        const findAccountCenterById = buildFindEntityByIdWithPool(connection)(AccountCenters);
        const updateAccountCenter = buildUpdateWhereWithPool(connection)(AccountCenters, true);
        const customProfileFieldsQueries = createCustomProfileFieldsQueries(connection);

        // Lock the default rows so concurrent updates serialize on this transaction and prevent
        // lost updates when rewriting the full profile field arrays.
        await connection.query(sql`
          select ${signInExperienceIdentifiers.fields.id}
          from ${signInExperienceIdentifiers.table}
          where ${signInExperienceIdentifiers.fields.id} = ${defaultId}
          for update
        `);
        await connection.query(sql`
          select ${accountCenterIdentifiers.fields.id}
          from ${accountCenterIdentifiers.table}
          where ${accountCenterIdentifiers.fields.id} = ${defaultId}
          for update
        `);

        const [signInExperience, accountCenter] = await Promise.all([
          findSignInExperienceById(defaultId),
          findAccountCenterById(defaultId),
        ]);

        const signUpProfileFields = removeProfileFieldByName(
          signInExperience.signUpProfileFields,
          name
        );
        const accountCenterProfileFields = removeProfileFieldByName(
          accountCenter.profileFields,
          name
        );

        const shouldUpdateSignInExperience = Boolean(
          signInExperience.signUpProfileFields &&
            signUpProfileFields &&
            signUpProfileFields.length !== signInExperience.signUpProfileFields.length
        );
        const shouldUpdateAccountCenter = Boolean(
          accountCenter.profileFields &&
            accountCenterProfileFields &&
            accountCenterProfileFields.length !== accountCenter.profileFields.length
        );

        if (shouldUpdateSignInExperience) {
          await updateSignInExperience({
            set: { signUpProfileFields } satisfies Partial<SignInExperience>,
            where: { id: defaultId },
            jsonbMode: 'replace',
          });
        }

        if (shouldUpdateAccountCenter) {
          await updateAccountCenter({
            set: { profileFields: accountCenterProfileFields } satisfies Partial<AccountCenter>,
            where: { id: defaultId },
            jsonbMode: 'replace',
          });
        }

        await customProfileFieldsQueries.deleteCustomProfileFieldsByName(name);

        return {
          didUpdateSignInExperience: shouldUpdateSignInExperience,
          didUpdateAccountCenter: shouldUpdateAccountCenter,
        };
      }
    );

    // Invalidate caches only after the transaction commits, so concurrent readers cannot
    // repopulate them with pre-commit data during the cache delete window.
    const invalidations = [
      didUpdateSignInExperience && queries.wellKnownCache.delete('sie', BaseCache.defaultKey),
      didUpdateAccountCenter &&
        queries.wellKnownCache.delete('account-center', BaseCache.defaultKey),
    ].filter((value): value is Promise<void> => value !== false);

    if (invalidations.length > 0) {
      await Promise.all(invalidations.map(async (promise) => trySafe(promise)));
    }
  };

  const normalizeProfileFields = async <ProfileFields extends NormalizableProfileFields>(
    profileFields: ProfileFields
  ): Promise<ProfileFields | undefined> => {
    if (!profileFields) {
      return profileFields;
    }

    await validateProfileFieldsList(profileFields);
    return profileFields;
  };

  return {
    createCustomProfileField,
    createCustomProfileFieldsBatch,
    updateCustomProfileField,
    updateCustomProfileFieldsSieOrder,
    deleteCustomProfileField,
    normalizeProfileFields,
  };
};
