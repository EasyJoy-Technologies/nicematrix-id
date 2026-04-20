/**
 * [NiceMatrix] Address editor modal.
 *
 * The current Logto sign-in experience only enables `address.formatted` (the
 * free-text address), so we only render one textarea. When more address parts
 * are enabled we can extend this component to render each sub-field.
 */
import { useEffect, useState, type FormEvent } from 'react';
import ReactModal from 'react-modal';
import { useTranslation } from 'react-i18next';

import styles from './index.module.scss';

type Props = {
  readonly isOpen: boolean;
  readonly title: string;
  readonly label: string;
  readonly initialValue: string;
  readonly maxLength?: number;
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (formatted: string) => void | Promise<void>;
};

const AddressEditor = ({
  isOpen,
  title,
  label,
  initialValue,
  maxLength = 100,
  isSubmitting,
  errorMessage,
  onCancel,
  onSubmit,
}: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(value.trim());
  };

  return (
    <ReactModal
      ariaHideApp={false}
      isOpen={isOpen}
      className={styles.modal}
      overlayClassName={styles.overlay}
      shouldCloseOnEsc
      shouldCloseOnOverlayClick
      onRequestClose={onCancel}
    >
      <div className={styles.title}>{title}</div>
      <form className={styles.field} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="nm-address-editor-input">
          {label}
        </label>
        <textarea
          id="nm-address-editor-input"
          className={styles.textarea}
          value={value}
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
        />
        {errorMessage && <div className={styles.error}>{errorMessage}</div>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {t('profile_section.cancel')}
          </button>
          <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
            {t('profile_section.save')}
          </button>
        </div>
      </form>
    </ReactModal>
  );
};

export default AddressEditor;
