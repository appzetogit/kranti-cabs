import { useCallback, useState } from 'react';
import api from '../../shared/api/axiosInstance';

/**
 * Submits a marketing form to the enquiry endpoint.
 *
 * These five forms used to call setSubmitted(true) and nothing else, so every
 * lead was discarded — the contact form even told the sender a confirmation
 * email had gone out. The success screens they already had are kept; the
 * difference is that the submission now actually goes somewhere, and a failure
 * says so instead of pretending it worked.
 */
export default function useEnquiryForm(type) {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(
    async (event, payload) => {
      if (event?.preventDefault) event.preventDefault();
      setSending(true);
      setError('');
      try {
        await api.post('/users/enquiry', { type, ...payload });
        setSubmitted(true);
      } catch (requestError) {
        setError(
          requestError?.response?.data?.message ||
            'Could not send your details. Please check them and try again.',
        );
      } finally {
        setSending(false);
      }
    },
    [type],
  );

  return { submitted, sending, error, submit };
}
