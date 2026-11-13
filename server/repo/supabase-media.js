const { ApiError } = require('../errors');

function createSupabaseMedia({ client, bucket }) {
  const store = () => client.storage.from(bucket);
  return {
    async put(objectPath, buffer, contentType) {
      const { error } = await store().upload(objectPath, buffer, { contentType, upsert: false, cacheControl: '31536000' });
      if (error) {
        const wrapped = new ApiError(502, 'storage_error', 'The image could not be stored. Try again in a moment.');
        wrapped.cause = error;
        throw wrapped;
      }
      return store().getPublicUrl(objectPath).data.publicUrl;
    },
    async remove(paths) {
      const { error } = await store().remove(paths);
      if (error) {
        const wrapped = new ApiError(502, 'storage_error', 'The image could not be removed. Try again in a moment.');
        wrapped.cause = error;
        throw wrapped;
      }
    }
  };
}

module.exports = { createSupabaseMedia };
