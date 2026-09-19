# The virus scanner behind the files service (Security Architecture §3), as a Railway service.
#
# The official image, with two lines of its clamd.conf changed and nothing else:
#
#   · TCPAddr ::   — Railway's private network is IPv6-only. The image ships clamd listening on
#     0.0.0.0, which is unreachable at `clamav.railway.internal`; `::` is dual-stack on Linux and
#     answers both. (Same lesson as `?family=0` on REDIS_URL and the OCR sidecar binding `::`.)
#   · StreamMaxLength — clamd refuses a stream larger than this with "INSTREAM size limit
#     exceeded", and the api then holds the file at `pending` forever. It must be at least
#     MAX_UPLOAD_MB (25 by default); 50M leaves room to raise that without redeploying this.
#
# No ENTRYPOINT/CMD of our own: the image's init starts freshclam (signature updates, hourly) and
# clamd, and `railway.json` sets no startCommand so that stays in charge. Mount a volume at
# /var/lib/clamav or the ~300 MB signature database downloads again on every deploy.
FROM clamav/clamav:stable

# Drop whatever the image says for the two keys (set or commented) and state them once at the
# end, so this holds whichever way the shipped file spells them. The final greps fail the IMAGE
# BUILD if the file is not the live clamd config — loud at build time, not silent at 02:00.
RUN sed -i -e '/^#\?TCPAddr /d' -e '/^#\?StreamMaxLength /d' /etc/clamav/clamd.conf \
    && printf 'TCPAddr ::\nStreamMaxLength 50M\n' >> /etc/clamav/clamd.conf \
    && grep -q '^TCPSocket ' /etc/clamav/clamd.conf \
    && grep -q '^TCPAddr ::$' /etc/clamav/clamd.conf \
    && grep -q '^StreamMaxLength 50M$' /etc/clamav/clamd.conf

EXPOSE 3310
