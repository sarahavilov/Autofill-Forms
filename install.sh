zip -9 -r aff.xpi chrome defaults install.rdf chrome.manifest
wget --post-file=aff.xpi http://localhost:8888/
