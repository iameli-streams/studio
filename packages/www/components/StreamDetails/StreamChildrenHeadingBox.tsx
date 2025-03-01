import {
  Box,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Flex,
} from "@livepeer/design-system";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Stream } from "livepeer";
import { Dispatch, SetStateAction } from "react";
import Record from "components/StreamDetails/Record";
import Terminate from "components/StreamDetails/Terminate";
import Suspend from "components/StreamDetails/Suspend";
import Delete from "components/StreamDetails/Delete";
import { User } from "@livepeer.studio/api";

export type StreamChildrenHeadingBoxProps = {
  stream: Stream;
  user: User;
  activeTab: string;
  setSwitchTab: Dispatch<SetStateAction<"Overview" | "Health">>;
  invalidateStream: () => void;
};

const StreamChildrenHeadingBox = ({
  stream,
  user,
  activeTab,
  setSwitchTab,
  invalidateStream,
}: StreamChildrenHeadingBoxProps) => {
  const userIsAdmin = user && user.admin;
  return (
    <Flex
      justify="between"
      css={{
        borderBottom: "1px solid",
        borderColor: "$neutral6",
        mb: "$4",
        width: "100%",
      }}>
      <Box css={{ display: "flex" }}>
        <Box
          as="div"
          onClick={() => setSwitchTab("Overview")}
          css={{
            pb: "$2",
            width: "100%",
            cursor: "default",
            textDecoration: "none",
            borderBottom: "2px solid",
            borderColor: activeTab === "Overview" ? "$green9" : "transparent",
            mr: "$5",
            "&:hover": {
              textDecoration: "none",
            },
          }}>
          Overview
        </Box>

        <Box
          as="div"
          onClick={() => setSwitchTab("Health")}
          css={{
            textDecoration: "none",
            pb: "$2",
            width: "100%",
            cursor: "default",
            borderBottom: "2px solid",
            borderColor: activeTab === "Health" ? "$green9" : "transparent",
            "&:hover": {
              textDecoration: "none",
            },
          }}>
          Health
        </Box>
      </Box>
      <Box css={{ position: "relative", top: "-8px" }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="2" css={{ display: "flex", ai: "center", mr: "$1" }}>
              Actions
              <Box as={ChevronDownIcon} css={{ ml: "$1" }} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <Record
                stream={stream}
                invalidate={invalidateStream}
                isSwitch={false}
              />
              <Suspend stream={stream} invalidate={invalidateStream} />
              <Delete stream={stream} invalidate={invalidateStream} />
              {userIsAdmin && stream.isActive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Admin only</DropdownMenuLabel>
                  <Terminate stream={stream} invalidate={invalidateStream} />
                </>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Box>
    </Flex>
  );
};

export default StreamChildrenHeadingBox;
